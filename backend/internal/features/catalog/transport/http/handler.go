package catalog_transport_http

import (
	"encoding/json"
	"fmt"
	"net/http"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
)

type Handler struct {
	svc       *catalog_service.Service
	adminAuth core_http_middleware.Middleware
}

func New(svc *catalog_service.Service, adminToken string) *Handler {
	return &Handler{
		svc:       svc,
		adminAuth: core_http_middleware.AdminAuth(adminToken),
	}
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request) *core_http_response.HTTPResponseHandler {
	log := core_logger.FromContext(r.Context())
	return core_http_response.NewHTTPResponseHandler(log, w, r.Header.Get("X-Request-ID"))
}

func decodeJSON(r *http.Request, dst any) error {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return fmt.Errorf("decode json: %w", core_errors.ErrInvalidArgument)
	}
	return nil
}
