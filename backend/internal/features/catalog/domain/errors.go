package catalog_domain

import (
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

type RevisionMismatchError struct {
	Base    int64
	Current int64
}

func (e *RevisionMismatchError) Error() string {
	return fmt.Sprintf("deck revision is r%d, changeset is based on r%d: %v", e.Current, e.Base, core_errors.ErrPreconditionFailed)
}
func (e *RevisionMismatchError) Unwrap() error     { return core_errors.ErrPreconditionFailed }
func (e *RevisionMismatchError) ErrorCode() string { return "revision_mismatch" }
func (e *RevisionMismatchError) ClientMessage() string {
	return "deck revision changed, nothing was written"
}
func (e *RevisionMismatchError) ErrorDetails() any {
	return struct {
		BaseRevision    int64 `json:"baseRevision"`
		CurrentRevision int64 `json:"currentRevision"`
	}{e.Base, e.Current}
}

type VersionMismatchError struct {
	ID       int64
	Expected int
	Actual   int
}

func (e *VersionMismatchError) Error() string {
	return fmt.Sprintf("card %d is at v%d, expected v%d: %v", e.ID, e.Actual, e.Expected, core_errors.ErrConflict)
}
func (e *VersionMismatchError) Unwrap() error     { return core_errors.ErrConflict }
func (e *VersionMismatchError) ErrorCode() string { return "version_mismatch" }
func (e *VersionMismatchError) ClientMessage() string {
	return "card version changed, nothing was written"
}
func (e *VersionMismatchError) ErrorDetails() any {
	return struct {
		ID       int64 `json:"id"`
		Expected int   `json:"expected"`
		Actual   int   `json:"actual"`
	}{e.ID, e.Expected, e.Actual}
}

type DuplicateCardError struct {
	Section string
	Index   int
	ID      int64
}

func (e *DuplicateCardError) Error() string {
	return fmt.Sprintf("%s[%d] duplicates an active card: %v", e.Section, e.Index, core_errors.ErrConflict)
}
func (e *DuplicateCardError) Unwrap() error     { return core_errors.ErrConflict }
func (e *DuplicateCardError) ErrorCode() string { return "duplicate_card" }
func (e *DuplicateCardError) ClientMessage() string {
	return "an active card with the same word, part of speech and translation already exists"
}
func (e *DuplicateCardError) ErrorDetails() any {
	return struct {
		Section string `json:"section"`
		Index   int    `json:"index"`
		ID      int64  `json:"id,omitempty"`
	}{e.Section, e.Index, e.ID}
}

type ValidationError struct {
	Errors []ChangesetError
}

func (e *ValidationError) Error() string {
	return e.ClientMessage() + ": " + core_errors.ErrInvalidArgument.Error()
}
func (e *ValidationError) Unwrap() error { return core_errors.ErrInvalidArgument }
func (e *ValidationError) ErrorCode() string {
	if len(e.Errors) == 0 {
		return ""
	}
	code := e.Errors[0].Code
	if code != CodeEmptyChangeset && code != CodeNoChanges {
		return ""
	}
	for _, item := range e.Errors[1:] {
		if item.Code != code {
			return ""
		}
	}
	return code
}
func (e *ValidationError) ClientMessage() string {
	if len(e.Errors) == 0 {
		return "invalid changeset"
	}
	if len(e.Errors) == 1 {
		return e.Errors[0].Message
	}
	return fmt.Sprintf("%s (and %d more)", e.Errors[0].Message, len(e.Errors)-1)
}
func (e *ValidationError) ErrorDetails() any {
	return struct {
		Errors []ChangesetError `json:"errors"`
	}{e.Errors}
}
