package core_http_server

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	"go.uber.org/zap"
)

type HTTPServer struct {
	mux        *http.ServeMux
	config     Config
	log        *core_logger.Logger
	middleware []core_http_middleware.Middleware
}

func NewHTTPServer(config Config, log *core_logger.Logger, middleware ...core_http_middleware.Middleware) *HTTPServer {
	return &HTTPServer{
		mux:        http.NewServeMux(),
		config:     config,
		log:        log,
		middleware: middleware,
	}
}

func (s *HTTPServer) RegisterAPIRouters(routers ...*APIVersionRouter) {
	for _, router := range routers {
		prefix := "/api/" + string(router.apiVersion)
		s.mux.Handle(prefix+"/", http.StripPrefix(prefix, router.WithMiddleware()))
	}
}

func (s *HTTPServer) RegisterRoutes(routes ...Route) {
	for _, route := range routes {
		pattern := fmt.Sprintf("%s %s", route.Method, route.Path)
		s.mux.Handle(pattern, route.WithMiddleware())
	}
}

func (s *HTTPServer) httpServer() *http.Server {
	cfg := s.config.withDefaults()
	return &http.Server{
		Addr:              cfg.Addr,
		Handler:           core_http_middleware.ChainMiddleware(s.mux, s.middleware...),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    cfg.MaxHeaderBytes,
	}
}

func (c Config) withDefaults() Config {
	if c.ReadHeaderTimeout <= 0 {
		c.ReadHeaderTimeout = readHeaderTimeout
	}
	if c.ReadTimeout <= 0 {
		c.ReadTimeout = readTimeout
	}
	if c.WriteTimeout <= 0 {
		c.WriteTimeout = writeTimeout
	}
	if c.IdleTimeout <= 0 {
		c.IdleTimeout = idleTimeout
	}
	if c.MaxHeaderBytes <= 0 {
		c.MaxHeaderBytes = maxHeaderBytes
	}
	return c
}

func (s *HTTPServer) Run(ctx context.Context) error {
	server := s.httpServer()

	ch := make(chan error, 1)

	go func() {
		defer close(ch)
		s.log.Warn("start HTTP server", zap.String("addr", s.config.Addr))
		err := server.ListenAndServe()
		if !errors.Is(err, http.ErrServerClosed) {
			ch <- err
		}
	}()

	select {
	case err := <-ch:
		if err != nil {
			return fmt.Errorf("listen and serve HTTP: %w", err)
		}
	case <-ctx.Done():
		s.log.Warn("shutdown HTTP server...")

		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return fmt.Errorf("shutdown HTTP server: %w", err)
		}

		s.log.Warn("HTTP server stopped")
	}

	return nil
}

func (s *HTTPServer) Handler() http.Handler {
	return core_http_middleware.ChainMiddleware(s.mux, s.middleware...)
}
