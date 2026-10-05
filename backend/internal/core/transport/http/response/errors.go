package core_http_response

import (
	"context"
	"errors"
	"net/http"
	"strings"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

const (
	CodeInvalidArgument = "invalid_argument"
	CodeUnauthenticated = "unauthenticated"
	CodeNotFound        = "not_found"
	CodeConflict        = "conflict"
	CodeInternal        = "internal"
	CodeCanceled        = "canceled"
	CodeTimeout         = "timeout"
	CodeUnavailable     = "unavailable"
)

const statusClientClosedRequest = 499

type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ErrorEnvelope struct {
	Error     ErrorBody `json:"error"`
	RequestID string    `json:"request_id"`
}

func mapError(err error) (status int, code string) {
	switch {
	case errors.Is(err, core_errors.ErrInvalidArgument):
		return http.StatusBadRequest, CodeInvalidArgument
	case errors.Is(err, core_errors.ErrUnauthenticated):
		return http.StatusUnauthorized, CodeUnauthenticated
	case errors.Is(err, core_errors.ErrNotFound):
		return http.StatusNotFound, CodeNotFound
	case errors.Is(err, core_errors.ErrConflict):
		return http.StatusConflict, CodeConflict
	case errors.Is(err, core_errors.ErrNotReady):
		return http.StatusServiceUnavailable, CodeUnavailable
	case errors.Is(err, context.Canceled):
		return statusClientClosedRequest, CodeCanceled
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, CodeTimeout
	default:
		return http.StatusInternalServerError, CodeInternal
	}
}

func clientErrorMessage(err error, fallback string, status int) string {
	if status == http.StatusInternalServerError {
		return "internal error"
	}
	if status != http.StatusBadRequest {
		return fallback
	}

	text := strings.TrimSpace(err.Error())
	text = strings.TrimSuffix(text, ": "+core_errors.ErrInvalidArgument.Error())
	text = strings.TrimSpace(text)
	if text == "" || text == core_errors.ErrInvalidArgument.Error() {
		return fallback
	}
	return text
}
