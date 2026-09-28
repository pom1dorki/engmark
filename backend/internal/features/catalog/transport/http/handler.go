package catalog_transport_http

import (
	"net/http"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
)

type Handler struct {
	svc *catalog_service.Service
}

func New(svc *catalog_service.Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request) *core_http_response.HTTPResponseHandler {
	log := core_logger.FromContext(r.Context())
	return core_http_response.NewHTTPResponseHandler(log, w, r.Header.Get("X-Request-ID"))
}
