package core_http_response

import (
	"context"
	"errors"
	"net/http"
	"strings"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

const (
	CodeInvalidArgument    = "invalid_argument"
	CodeUnauthenticated    = "unauthenticated"
	CodeForbidden          = "forbidden"
	CodeNotFound           = "not_found"
	CodeConflict           = "conflict"
	CodeInternal           = "internal"
	CodeCanceled           = "canceled"
	CodeTimeout            = "timeout"
	CodeUnavailable        = "unavailable"
	CodeRevisionMismatch   = "revision_mismatch"
	CodePreconditionNeeded = "precondition_required"
	CodePayloadTooLarge    = "payload_too_large"
	CodeTooManyRequests    = "too_many_requests"
)

const statusClientClosedRequest = 499

type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

type ErrorEnvelope struct {
	Error     ErrorBody `json:"error"`
	RequestID string    `json:"request_id"`
}

type ClientError interface {
	error
	ErrorCode() string
	ClientMessage() string
	ErrorDetails() any
}

func mapError(err error) (status int, code string) {
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &tooLarge), errors.Is(err, core_errors.ErrPayloadTooLarge):
		return http.StatusRequestEntityTooLarge, CodePayloadTooLarge
	case errors.Is(err, core_errors.ErrInvalidArgument):
		return http.StatusBadRequest, CodeInvalidArgument
	case errors.Is(err, core_errors.ErrUnauthenticated):
		return http.StatusUnauthorized, CodeUnauthenticated
	case errors.Is(err, core_errors.ErrForbidden):
		return http.StatusForbidden, CodeForbidden
	case errors.Is(err, core_errors.ErrNotFound):
		return http.StatusNotFound, CodeNotFound
	case errors.Is(err, core_errors.ErrPreconditionFailed):
		return http.StatusPreconditionFailed, CodeRevisionMismatch
	case errors.Is(err, core_errors.ErrPreconditionRequired):
		return http.StatusPreconditionRequired, CodePreconditionNeeded
	case errors.Is(err, core_errors.ErrConflict):
		return http.StatusConflict, CodeConflict
	case errors.Is(err, core_errors.ErrTooManyRequests):
		return http.StatusTooManyRequests, CodeTooManyRequests
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

func describe(err error, fallback string) (status int, body ErrorBody) {
	status, code := mapError(err)
	body = ErrorBody{Code: code, Message: clientErrorMessage(err, fallback, status)}
	if status == http.StatusInternalServerError {
		return status, body
	}
	var ce ClientError
	if errors.As(err, &ce) {
		if c := ce.ErrorCode(); c != "" {
			body.Code = c
		}
		if m := ce.ClientMessage(); m != "" {
			body.Message = m
		}
		body.Details = ce.ErrorDetails()
	}
	return status, body
}
