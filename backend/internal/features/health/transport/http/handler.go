package health_transport_http

import (
	"net/http"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
)

type statusBody struct {
	Status string `json:"status"`
}

func HandleLivez(w http.ResponseWriter, r *http.Request) {
	log := core_logger.FromContext(r.Context())
	requestID := r.Header.Get("X-Request-ID")
	h := core_http_response.NewHTTPResponseHandler(log, w, requestID)
	h.JSONResponse(statusBody{Status: "ok"}, http.StatusOK)
}

func HandleReadyz(w http.ResponseWriter, r *http.Request) {
	log := core_logger.FromContext(r.Context())
	requestID := r.Header.Get("X-Request-ID")
	h := core_http_response.NewHTTPResponseHandler(log, w, requestID)
	h.ErrorResponse(core_errors.ErrNotReady, "not ready")
}
