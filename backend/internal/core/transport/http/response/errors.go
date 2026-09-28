package core_http_response

import (
	"errors"
	"net/http"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

const (
	CodeInvalidArgument = "invalid_argument"
	CodeUnauthenticated = "unauthenticated"
	CodeNotFound        = "not_found"
	CodeConflict        = "conflict"
	CodeInternal        = "internal"
)

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ErrorEnvelope struct {
	Error     errorBody `json:"error"`
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
		return http.StatusServiceUnavailable, "unavailable"
	default:
		return http.StatusInternalServerError, CodeInternal
	}
}
