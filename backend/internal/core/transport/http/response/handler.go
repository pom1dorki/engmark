package core_http_response

import (
	"encoding/json"
	"fmt"
	"net/http"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	"go.uber.org/zap"
)

type HTTPResponseHandler struct {
	log       *core_logger.Logger
	rw        http.ResponseWriter
	requestID string
}

func NewHTTPResponseHandler(log *core_logger.Logger, rw http.ResponseWriter, requestID string) *HTTPResponseHandler {
	return &HTTPResponseHandler{log: log, rw: rw, requestID: requestID}
}

func (h *HTTPResponseHandler) JSONResponse(body any, statusCode int) {
	h.rw.Header().Set("Content-Type", "application/json; charset=utf-8")
	h.rw.WriteHeader(statusCode)
	if err := json.NewEncoder(h.rw).Encode(body); err != nil {
		h.log.Error("write HTTP response", zap.Error(err))
	}
}

func (h *HTTPResponseHandler) NoContentResponse() {
	h.rw.WriteHeader(http.StatusNoContent)
}

func (h *HTTPResponseHandler) ErrorResponse(err error, msg string) {
	status, code := mapError(err)

	logFunc := h.log.Warn
	clientMsg := msg
	switch status {
	case http.StatusNotFound:
		logFunc = h.log.Debug
	case http.StatusInternalServerError:
		logFunc = h.log.Error
		clientMsg = "internal error"
	}

	logFunc(msg, zap.Error(err), zap.String("request_id", h.requestID))
	h.JSONResponse(ErrorEnvelope{
		Error:     ErrorBody{Code: code, Message: clientMsg},
		RequestID: h.requestID,
	}, status)
}

func (h *HTTPResponseHandler) PanicResponse(p any, msg string) {
	err := fmt.Errorf("unexpected panic: %v", p)
	h.ErrorResponse(err, msg)
}
