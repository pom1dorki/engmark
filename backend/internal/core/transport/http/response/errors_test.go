package core_http_response

import (
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
