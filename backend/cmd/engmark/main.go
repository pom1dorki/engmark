package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/pom1dorki/engmark/docs"
	core_config "github.com/pom1dorki/engmark/internal/core/config"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_pgx_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool/pgx"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	catalog_admin "github.com/pom1dorki/engmark/internal/features/catalog/admin"
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

	pool, err := core_pgx_pool.NewPool(ctx, core_pgx_pool.NewConfigMust())
	if err != nil {
		logger.Error("failed to init postgres connection pool", zap.Error(err))
		os.Exit(1)
	}
	defer pool.Close()

	healthHandler := health_transport_http.NewHandler(health_service.NewService(pool))

	httpConfig := core_http_server.NewConfigMust()
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

	catalogHandler := catalog_transport_http.New(
		catalog_service.New(catalog_postgres_repository.New(pool)),
		adminConfig.Token,
	)
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(catalogHandler.Routes()...)
	httpServer.RegisterAPIRouters(v1)

	httpServer.RegisterRoutes(swaggerRoute())

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
