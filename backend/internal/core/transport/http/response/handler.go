package core_http_response

import (
	"encoding/json"
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
	setJSONHeaders(h.rw.Header())
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
	clientMsg := clientErrorMessage(err, msg, status)
	fields := []zap.Field{zap.Error(err)}

	switch status {
	case statusClientClosedRequest:
		h.log.Debug(msg, fields...)
		h.rw.WriteHeader(status)
		return
	case http.StatusNotFound:
		h.log.Debug(msg, fields...)
	case http.StatusGatewayTimeout:
		h.log.Warn(msg, fields...)
	case http.StatusInternalServerError:
		h.log.Error(msg, fields...)
	default:
		h.log.Warn(msg, fields...)
	}

	h.JSONResponse(ErrorEnvelope{
		Error:     ErrorBody{Code: code, Message: clientMsg},
		RequestID: h.requestID,
	}, status)
}

func (h *HTTPResponseHandler) PanicResponse(p any, msg string) {
	h.log.Error(msg, zap.Any("panic", p), zap.Stack("stack"))
	if headersSent(h.rw) {
		return
	}
	h.JSONResponse(ErrorEnvelope{
		Error:     ErrorBody{Code: CodeInternal, Message: "internal error"},
		RequestID: h.requestID,
	}, http.StatusInternalServerError)
}

func headersSent(w http.ResponseWriter) bool {
	for w != nil {
		if hw, ok := w.(interface{ WroteHeader() bool }); ok {
			return hw.WroteHeader()
		}
		unw, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return false
		}
		w = unw.Unwrap()
	}
	return false
}
