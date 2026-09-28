package core_http_request

import (
	"fmt"
	"net/http"
	"strconv"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

func GetInt64PathValue(r *http.Request, key string) (int64, error) {
	raw := r.PathValue(key)
	if raw == "" {
		return 0, fmt.Errorf("path %s is missing: %w", key, core_errors.ErrInvalidArgument)
	}

	val, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("path %s=%q is not an integer: %w", key, raw, core_errors.ErrInvalidArgument)
	}

	return val, nil
}
