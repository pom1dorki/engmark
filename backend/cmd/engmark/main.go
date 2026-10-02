package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/pom1dorki/engmark/docs"
	core_config "github.com/pom1dorki/engmark/internal/core/config"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_pgx_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool/pgx"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	catalog_admin "github.com/pom1dorki/engmark/internal/features/catalog/admin"
	catalog_cardsfile "github.com/pom1dorki/engmark/internal/features/catalog/cardsfile"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
	catalog_transport_http "github.com/pom1dorki/engmark/internal/features/catalog/transport/http"
	health_service "github.com/pom1dorki/engmark/internal/features/health/service"
	health_transport_http "github.com/pom1dorki/engmark/internal/features/health/transport/http"
	httpSwagger "github.com/swaggo/http-swagger/v2"
	"go.uber.org/zap"
)

// @title Engmark API
// @version 0.1
// @description Card catalog. Admin writes require Authorization: Bearer <ADMIN_TOKEN>.
// @host localhost:5050
// @BasePath /
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Value is "Bearer <ADMIN_TOKEN>". Do not put a real token here.
func main() {
	cfg := core_config.NewConfigMust()
	time.Local = cfg.TimeZone

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	logger, err := core_logger.NewLogger(core_logger.NewConfigMust())
	if err != nil {
		fmt.Println("failed to init application logger:", err)
		os.Exit(1)
	}
	defer logger.Close()

	logger.Debug("application time zone", zap.Any("zone", time.Local))

	adminConfig, err := catalog_admin.NewConfig()
	if err != nil {
		logger.Error("failed to init admin config", zap.Error(err))
		os.Exit(1)
	}

	pgConfig, err := core_pgx_pool.NewConfig()
	if err != nil {
		logger.Error("failed to init postgres config", zap.Error(err))
		os.Exit(1)
	}
	if dir := strings.TrimSpace(os.Getenv("MIGRATIONS_PATH")); dir != "" {
		dsn, err := core_pgx_pool.ConnectionURL(pgConfig)
		if err != nil {
			logger.Error("failed to build postgres url", zap.Error(err))
			os.Exit(1)
		}
		if err := core_pgx_pool.MigrateUp(dsn, dir); err != nil {
			logger.Error("failed to migrate", zap.Error(err))
			os.Exit(1)
		}
		logger.Info("database schema is current")
	}

	pool, err := core_pgx_pool.NewPool(ctx, pgConfig)
	if err != nil {
		logger.Error("failed to init postgres connection pool", zap.Error(err))
		os.Exit(1)
	}
	defer pool.Close()

	catalogSvc := catalog_service.New(catalog_postgres_repository.New(pool))
	if cardsPath := strings.TrimSpace(os.Getenv("CARDS_FILE")); cardsPath != "" {
		cards, err := catalog_cardsfile.Read(cardsPath)
		if err != nil {
			logger.Error("failed to read cards", zap.Error(err))
			os.Exit(1)
		}
		if err := catalogSvc.ReplaceAdminCards(ctx, cards); err != nil {
			logger.Error("failed to replace admin deck", zap.Error(err))
			os.Exit(1)
		}
		logger.Info("replaced admin deck", zap.Int("cards", len(cards)))
	}

	healthHandler := health_transport_http.NewHandler(health_service.NewService(pool))

	httpConfig, err := core_http_server.NewConfig()
	if err != nil {
		logger.Error("failed to init http config", zap.Error(err))
		os.Exit(1)
	}
	httpServer := core_http_server.NewHTTPServer(
		httpConfig,
		logger,
		core_http_middleware.CORS(httpConfig.AllowedOrigins),
		core_http_middleware.RequestID(),
		core_http_middleware.Logger(logger),
		core_http_middleware.Trace(),
		core_http_middleware.Panic(),
		core_http_middleware.LimitBody(32<<10),
	)

	httpServer.RegisterRoutes(healthHandler.Routes()...)

	catalogHandler := catalog_transport_http.New(catalogSvc, adminConfig.Token)
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(catalogHandler.Routes()...)
	httpServer.RegisterAPIRouters(v1)

	if httpConfig.Swagger {
		httpServer.RegisterRoutes(swaggerRoute())
	}
	if err := httpServer.RegisterStatic(httpConfig.StaticDir); err != nil {
		logger.Error("failed to register static files", zap.Error(err))
		os.Exit(1)
	}

	if err := httpServer.Run(ctx); err != nil {
		logger.Error("HTTP server run error", zap.Error(err))
	}
}

func swaggerRoute() core_http_server.Route {
	return core_http_server.Route{
		Method: http.MethodGet,
		Path:   "/swagger/",
		Handler: httpSwagger.Handler(
			httpSwagger.URL("/swagger/doc.json"),
			httpSwagger.DefaultModelsExpandDepth(-1),
		),
	}
}
