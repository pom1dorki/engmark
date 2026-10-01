package core_http_middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
)

func AdminAuth(token string) Middleware {
	expected := []byte(token)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log := core_logger.FromContext(r.Context())
			requestID := r.Header.Get(requestIDHeader)
			resp := core_http_response.NewHTTPResponseHandler(log, w, requestID)

			raw := r.Header.Get("Authorization")
			scheme, got, ok := strings.Cut(raw, " ")
			if !ok || !strings.EqualFold(scheme, "Bearer") || got == "" {
				resp.ErrorResponse(core_errors.ErrUnauthenticated, "unauthenticated")
				return
			}

			gotBytes := []byte(got)
			if len(gotBytes) != len(expected) ||
				subtle.ConstantTimeCompare(gotBytes, expected) != 1 {
				resp.ErrorResponse(core_errors.ErrUnauthenticated, "unauthenticated")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
