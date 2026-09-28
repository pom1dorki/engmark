package core_http_middleware

import (
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

func CORS(allowedOriginsList []string) Middleware {
	allowed := make(map[string]struct{}, len(allowedOriginsList))
	for _, origin := range allowedOriginsList {
		allowed[origin] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

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
			log.Info(
				"HTTP request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", rw.GetStatusCode()),
				zap.Duration("latency", time.Since(started)),
			)
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
				if p := recover(); p != nil {
					responseHandler.PanicResponse(p, "during handle HTTP request got unexpected panic")
				}
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
