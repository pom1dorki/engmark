package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
	adminauth_postgres_repository "github.com/pom1dorki/engmark/internal/features/adminauth/repository/postgres"
	adminauth_service "github.com/pom1dorki/engmark/internal/features/adminauth/service"
	adminauth_transport_http "github.com/pom1dorki/engmark/internal/features/adminauth/transport/http"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
	catalog_snapshot "github.com/pom1dorki/engmark/internal/features/catalog/snapshot"
	catalog_transport_http "github.com/pom1dorki/engmark/internal/features/catalog/transport/http"
	catalog_admin_transport_http "github.com/pom1dorki/engmark/internal/features/catalog/transport/http/admin"
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

	adminCfg, err := adminauth_domain.NewConfig()
	if err != nil {
		logger.Error("failed to read admin config", zap.Error(err))
		os.Exit(1)
	}

	repo := catalog_postgres_repository.New(pool)
	store := catalog_snapshot.New()
	catalogSvc := catalog_service.New(repo).WithHooks(catalog_service.Hooks{
		OnCommitted: func(ctx context.Context, revision int64) {
			ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			if err := store.Reload(ctx, repo, catalog_transport_http.MarshalCardList); err != nil {
				logger.Error("failed to rebuild catalog snapshot", zap.Int64("revision", revision), zap.Error(err))
				return
			}
			logger.Info("catalog snapshot rebuilt", zap.Int64("revision", store.Revision()))
		},
		SnapshotRevision: store.Revision,
	})

	if err := seedCatalog(sigCtx, logger, catalogSvc, cardsFile); err != nil {
		logger.Error("failed to seed the admin deck", zap.Error(err))
		os.Exit(1)
	}
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
	)

	httpServer.RegisterRoutes(healthHandler.Routes()...)

	catalogHandler := catalog_transport_http.New(store)
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(core_http_server.WithMiddleware(catalogHandler.Routes(), core_http_middleware.LimitBody(32<<10))...)

	if adminCfg.Enabled() {
		if err := registerAdmin(runCtx, logger, v1, pool, adminCfg, catalogSvc); err != nil {
			logger.Error("failed to init admin", zap.Error(err))
			os.Exit(1)
		}
	} else {
		logger.Warn("ADMIN_PASSWORD_HASH is empty: the admin API is disabled and answers 404")
		v1.Handle("/admin/", adminauth_transport_http.DisabledHandler())
	}
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

func registerAdmin(ctx context.Context, logger *core_logger.Logger, v1 *core_http_server.APIVersionRouter, pool *pgxpool.Pool, cfg adminauth_domain.Config, catalogSvc *catalog_service.Service) error {
	authSvc := adminauth_service.New(adminauth_postgres_repository.New(pool), cfg)
	guard, err := adminauth_transport_http.NewGuard(authSvc, cfg)
	if err != nil {
		return err
	}
	v1.RegisterRoutes(adminauth_transport_http.New(authSvc, guard).Routes()...)
	v1.RegisterRoutes(core_http_server.WithMiddleware(
		catalog_admin_transport_http.New(catalogSvc).Routes(),
		guard.NoStore(), guard.RequireAdmin(),
	)...)
	go authSvc.RunCleanup(ctx, time.Hour, logger)
	logger.Info("admin API enabled", zap.Duration("session_ttl", cfg.SessionTTL), zap.Bool("cookie_secure", cfg.CookieSecure))
	return nil
}
