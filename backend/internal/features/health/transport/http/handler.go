package health_transport_http

import (
	"net/http"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	health_service "github.com/pom1dorki/engmark/internal/features/health/service"
)

type StatusBody struct {
	Status  string `json:"status"`
	Version string `json:"version,omitempty"`
}

type Handler struct {
	svc     *health_service.Service
	version string
}

func NewHandler(svc *health_service.Service, version string) *Handler {
	return &Handler{svc: svc, version: version}
}

func (h *Handler) HandleLivez(w http.ResponseWriter, r *http.Request) {
	log := core_logger.FromContext(r.Context())
	requestID := r.Header.Get("X-Request-ID")
	resp := core_http_response.NewHTTPResponseHandler(log, w, requestID)
	resp.JSONResponse(StatusBody{Status: "ok", Version: h.version}, http.StatusOK)
}

func (h *Handler) HandleReadyz(w http.ResponseWriter, r *http.Request) {
	log := core_logger.FromContext(r.Context())
	requestID := r.Header.Get("X-Request-ID")
	resp := core_http_response.NewHTTPResponseHandler(log, w, requestID)

	if err := h.svc.Ready(r.Context()); err != nil {
		resp.ErrorResponse(err, "not ready")
		return
	}
	resp.JSONResponse(StatusBody{Status: "ok", Version: h.version}, http.StatusOK)
}
