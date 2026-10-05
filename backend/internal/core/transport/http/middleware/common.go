package core_http_middleware

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	"go.uber.org/zap"
)

const (
	requestIDHeader = "X-Request-ID"
	maxBodyBytes    = 32 << 10
)

func RequestID() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestID := r.Header.Get(requestIDHeader)
			if requestID == "" {
				requestID = uuid.NewString()
			}
			r.Header.Set(requestIDHeader, requestID)
			w.Header().Set(requestIDHeader, requestID)
			next.ServeHTTP(w, r)
		})
	}
}

func Logger(log *core_logger.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			l := log.With(
				zap.String("request_id", r.Header.Get(requestIDHeader)),
				zap.String("url", r.URL.String()),
			)
			ctx := core_logger.ToContext(r.Context(), l)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func Trace() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log := core_logger.FromContext(r.Context())
			rw := core_http_response.NewResponseWriter(w)
			started := time.Now()

			log.Debug("incoming HTTP request", zap.String("method", r.Method))
			next.ServeHTTP(rw, r)

			status := rw.GetStatusCode()
			fields := []zap.Field{
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", status),
				zap.Int("bytes", rw.Written()),
				zap.Duration("latency", time.Since(started)),
			}
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
				if status >= 400 {
					log.Warn("HTTP request", fields...)
					return
				}
				log.Debug("HTTP request", fields...)
				return
			}
			log.Info("HTTP request", fields...)
		})
	}
}

func Panic() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log := core_logger.FromContext(r.Context())
			requestID := r.Header.Get(requestIDHeader)
			responseHandler := core_http_response.NewHTTPResponseHandler(log, w, requestID)

			defer func() {
				p := recover()
				if p == nil {
					return
				}
				if err, ok := p.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(p)
				}
				responseHandler.PanicResponse(p, "during handle HTTP request got unexpected panic")
			}()

			next.ServeHTTP(w, r)
		})
	}
}

func LimitBody(limit int64) Middleware {
	if limit <= 0 {
		limit = maxBodyBytes
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > limit {
				log := core_logger.FromContext(r.Context())
				requestID := r.Header.Get(requestIDHeader)
				core_http_response.NewHTTPResponseHandler(log, w, requestID).
					ErrorResponse(core_errors.ErrInvalidArgument, "request body too large")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}
