package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	catalog_cardsfile "github.com/pom1dorki/engmark/internal/features/catalog/cardsfile"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
	catalog_snapshot "github.com/pom1dorki/engmark/internal/features/catalog/snapshot"
	catalog_transport_http "github.com/pom1dorki/engmark/internal/features/catalog/transport/http"
	health_service "github.com/pom1dorki/engmark/internal/features/health/service"
	health_transport_http "github.com/pom1dorki/engmark/internal/features/health/transport/http"
	"go.uber.org/zap"
)

const (
	cardsFile    = "data/cards.json"
	notReadyWait = 2 * time.Second
)

var version = "dev"

func main() {
	if len(os.Args) > 1 {
		os.Exit(runCommand(os.Args[1:]))
	}

	sigCtx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()
	runCtx, stopRun := context.WithCancel(context.Background())
	defer stopRun()

	logger, err := core_logger.NewLogger(core_logger.NewConfigMust())
	if err != nil {
		fmt.Println("failed to init application logger:", err)
		os.Exit(1)
	}
	defer logger.Close()
	logger.Info("starting engmark", zap.String("version", version))

	databaseURL, err := core_postgres.URLFromEnv()
	if err != nil {
		logger.Error("failed to read database url", zap.Error(err))
		os.Exit(1)
	}
	if err := core_postgres.Migrate(databaseURL); err != nil {
		logger.Error("failed to migrate", zap.Error(err))
		os.Exit(1)
	}
	logger.Info("database schema is current")

	pool, err := core_postgres.Open(sigCtx, databaseURL)
	if err != nil {
		logger.Error("failed to init postgres connection pool", zap.Error(err))
		os.Exit(1)
	}
	defer pool.Close()

	repo := catalog_postgres_repository.New(pool)
	catalogSvc := catalog_service.New(repo)
	cards, err := catalog_cardsfile.Read(cardsFile)
	if err != nil {
		logger.Error("failed to read cards", zap.Error(err))
		os.Exit(1)
	}
	if err := catalogSvc.ReplaceAdminCards(sigCtx, cards); err != nil {
		logger.Error("failed to sync admin deck", zap.Error(err))
		os.Exit(1)
	}
	logger.Info("synced admin deck", zap.Int("cards", len(cards)))

	store := catalog_snapshot.New()
	if err := store.Reload(sigCtx, repo, catalog_transport_http.MarshalCardList); err != nil {
		logger.Error("failed to load catalog snapshot", zap.Error(err))
		os.Exit(1)
	}

	healthSvc := health_service.NewService(pool)
	healthSvc.SetCatalogReady(func() bool { return store.Load() != nil })
	healthHandler := health_transport_http.NewHandler(healthSvc, version)

	httpConfig, err := core_http_server.NewConfig()
	if err != nil {
		logger.Error("failed to init http config", zap.Error(err))
		os.Exit(1)
	}
	httpServer := core_http_server.NewHTTPServer(
		httpConfig,
		logger,
		core_http_middleware.RequestID(),
		core_http_middleware.Logger(logger),
		core_http_middleware.Trace(),
		core_http_middleware.Panic(),
		core_http_middleware.LimitBody(32<<10),
	)

	httpServer.RegisterRoutes(healthHandler.Routes()...)

	catalogHandler := catalog_transport_http.New(store)
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(catalogHandler.Routes()...)
	httpServer.RegisterAPIRouters(v1)

	if err := httpServer.RegisterStatic(httpConfig.StaticDir); err != nil {
		logger.Error("failed to register static files", zap.Error(err))
		os.Exit(1)
	}

	go func() {
		<-sigCtx.Done()
		healthSvc.Drain()
		time.Sleep(notReadyWait)
		stopRun()
	}()

	if err := httpServer.Run(runCtx); err != nil {
		logger.Error("HTTP server run error", zap.Error(err))
	}
}
