package core_http_response

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

func TestClientErrorMessage(t *testing.T) {
	t.Parallel()

	validation := fmt.Errorf("exampleHighlight is not in example: %w", core_errors.ErrInvalidArgument)
	tests := []struct {
		name     string
		err      error
		fallback string
		status   int
		want     string
	}{
		{name: "validation", err: validation, fallback: "create card", status: http.StatusBadRequest, want: "exampleHighlight is not in example"},
		{name: "bare invalid", err: core_errors.ErrInvalidArgument, fallback: "request body too large", status: http.StatusBadRequest, want: "request body too large"},
		{name: "not found", err: core_errors.ErrNotFound, fallback: "get card", status: http.StatusNotFound, want: "get card"},
		{name: "internal", err: fmt.Errorf("scan card: boom"), fallback: "list cards", status: http.StatusInternalServerError, want: "internal error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := clientErrorMessage(tt.err, tt.fallback, tt.status)
			if got != tt.want {
				t.Fatalf("clientErrorMessage() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDescribeCodedErrors(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		status  int
		code    string
		message string
		details bool
	}{
		{name: "payload too large", err: core_errors.ErrPayloadTooLarge, status: http.StatusRequestEntityTooLarge, code: "payload_too_large", message: "fb"},
		{name: "max bytes reader", err: fmt.Errorf("decode: %w", &http.MaxBytesError{Limit: 10}), status: http.StatusRequestEntityTooLarge, code: "payload_too_large", message: "fb"},
		{name: "precondition failed", err: fmt.Errorf("x: %w", core_errors.ErrPreconditionFailed), status: http.StatusPreconditionFailed, code: "revision_mismatch", message: "fb"},
		{name: "precondition required", err: core_errors.ErrPreconditionRequired, status: http.StatusPreconditionRequired, code: "precondition_required", message: "fb"},
		{name: "too many requests", err: core_errors.ErrTooManyRequests, status: http.StatusTooManyRequests, code: "too_many_requests", message: "fb"},
		{
			name:   "coded forbidden",
			err:    &core_errors.CodedError{Err: core_errors.ErrForbidden, Code: "forbidden_origin", Message: "origin is not allowed"},
			status: http.StatusForbidden, code: "forbidden_origin", message: "origin is not allowed",
		},
		{
			name:   "coded conflict with details",
			err:    fmt.Errorf("wrapped: %w", &core_errors.CodedError{Err: core_errors.ErrConflict, Code: "version_mismatch", Message: "card changed", Details: map[string]int{"id": 7}}),
			status: http.StatusConflict, code: "version_mismatch", message: "card changed", details: true,
		},
		{name: "plain conflict", err: core_errors.ErrConflict, status: http.StatusConflict, code: "conflict", message: "fb"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, body := describe(tt.err, "fb")
			if status != tt.status || body.Code != tt.code || body.Message != tt.message || (body.Details != nil) != tt.details {
				t.Fatalf("describe() = %d %+v, want %d %s %q details=%v", status, body, tt.status, tt.code, tt.message, tt.details)
			}
		})
	}

	status, body := describe(&core_errors.CodedError{Err: errors.New("boom"), Code: "secret", Message: "leak", Details: 1}, "fb")
	if status != http.StatusInternalServerError || body.Code != "internal" || body.Message != "internal error" || body.Details != nil {
		t.Fatalf("internal = %d %+v", status, body)
	}
}
