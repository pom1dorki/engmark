package core_http_request

import (
	"fmt"
	"net/http"
	"strconv"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

func GetIntQueryParam(r *http.Request, key string) (*int, error) {
	param := r.URL.Query().Get(key)
	if param == "" {
		return nil, nil
	}

	val, err := strconv.Atoi(param)
	if err != nil {
		return nil, fmt.Errorf("query %s=%q is not an integer: %w", key, param, core_errors.ErrInvalidArgument)
	}

	return &val, nil
}

func GetInt64QueryParam(r *http.Request, key string) (*int64, error) {
	param := r.URL.Query().Get(key)
	if param == "" {
		return nil, nil
	}

	val, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("query %s=%q is not an integer: %w", key, param, core_errors.ErrInvalidArgument)
	}

	return &val, nil
}
