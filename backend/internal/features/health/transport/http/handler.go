package health_transport_http

import (
	"net/http"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	health_service "github.com/pom1dorki/engmark/internal/features/health/service"
)

type StatusBody struct {
	Status string `json:"status"`
}

type Handler struct {
	svc *health_service.Service
}

func NewHandler(svc *health_service.Service) *Handler {
	return &Handler{svc: svc}
}

// HandleLivez godoc
// @Summary Liveness
// @Tags health
// @Produce json
// @Success 200 {object} StatusBody
// @Router /healthz [get]
func (h *Handler) HandleLivez(w http.ResponseWriter, r *http.Request) {
	log := core_logger.FromContext(r.Context())
	requestID := r.Header.Get("X-Request-ID")
	resp := core_http_response.NewHTTPResponseHandler(log, w, requestID)
	resp.JSONResponse(StatusBody{Status: "ok"}, http.StatusOK)
}

// HandleReadyz godoc
// @Summary Readiness
// @Tags health
// @Produce json
// @Success 200 {object} StatusBody
// @Failure 503 {object} core_http_response.ErrorEnvelope
// @Router /readyz [get]
func (h *Handler) HandleReadyz(w http.ResponseWriter, r *http.Request) {
	log := core_logger.FromContext(r.Context())
	requestID := r.Header.Get("X-Request-ID")
	resp := core_http_response.NewHTTPResponseHandler(log, w, requestID)

	if err := h.svc.Ready(r.Context()); err != nil {
		resp.ErrorResponse(err, "not ready")
		return
	}
	resp.JSONResponse(StatusBody{Status: "ok"}, http.StatusOK)
}
