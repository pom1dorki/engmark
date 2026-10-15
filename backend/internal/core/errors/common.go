package core_errors

import "errors"

var (
	ErrNotFound             = errors.New("not found")
	ErrInvalidArgument      = errors.New("invalid argument")
	ErrConflict             = errors.New("conflict")
	ErrUnauthenticated      = errors.New("unauthenticated")
	ErrForbidden            = errors.New("forbidden")
	ErrNotReady             = errors.New("not ready")
	ErrPreconditionFailed   = errors.New("precondition failed")
	ErrPreconditionRequired = errors.New("precondition required")
	ErrPayloadTooLarge      = errors.New("payload too large")
	ErrTooManyRequests      = errors.New("too many requests")
)

type CodedError struct {
	Err     error
	Code    string
	Message string
	Details any
}

func (e *CodedError) Error() string {
	if e.Message != "" {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Err.Error()
}

func (e *CodedError) Unwrap() error         { return e.Err }
func (e *CodedError) ErrorCode() string     { return e.Code }
func (e *CodedError) ClientMessage() string { return e.Message }
func (e *CodedError) ErrorDetails() any     { return e.Details }
