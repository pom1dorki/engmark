package core_errors

import "errors"

var (
	ErrNotFound        = errors.New("not found")
	ErrInvalidArgument = errors.New("invalid argument")
	ErrConflict        = errors.New("conflict")
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrNotReady        = errors.New("not ready")
)
