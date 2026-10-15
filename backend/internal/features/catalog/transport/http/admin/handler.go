package catalog_admin_transport_http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

type Admin interface {
	DeckSummary(ctx context.Context) (catalog_domain.DeckSummary, error)
	ListCards(ctx context.Context, f catalog_domain.CardFilter) (catalog_domain.CardPage, error)
	GetCard(ctx context.Context, id int64) (catalog_domain.Card, error)
	ListCardVersions(ctx context.Context, id int64) ([]catalog_domain.CardVersion, error)
	GetCardVersion(ctx context.Context, id int64, version int) (catalog_domain.CardVersion, error)
	ListChangesSince(ctx context.Context, since int64) (catalog_domain.Changes, error)
	ValidateChangeset(ctx context.Context, cs catalog_domain.Changeset) (catalog_domain.ValidationReport, error)
	ApplyChangeset(ctx context.Context, cs catalog_domain.Changeset) (catalog_domain.ChangesetResult, error)
	ListRevisions(ctx context.Context, limit int, before int64) ([]catalog_domain.Revision, error)
	GetRevision(ctx context.Context, rev int64) (catalog_domain.RevisionDetail, error)
	RevertDraft(ctx context.Context, rev int64) (catalog_domain.Changeset, error)
	Export(ctx context.Context, rev *int64) (catalog_domain.DeckState, error)
}

type Handler struct {
	admin Admin
}

func New(admin Admin) *Handler {
	return &Handler{admin: admin}
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request) *core_http_response.HTTPResponseHandler {
	return core_http_response.NewHTTPResponseHandler(core_logger.FromContext(r.Context()), w, r.Header.Get("X-Request-ID"))
}

func revisionETag(rev int64) string { return `"r` + strconv.FormatInt(rev, 10) + `"` }
func versionETag(v int) string      { return `"v` + strconv.Itoa(v) + `"` }

func matchesETag(header, etag string) bool {
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if header == "*" {
		return true
	}
	for _, part := range strings.Split(header, ",") {
		if strings.TrimSpace(part) == etag {
			return true
		}
	}
	return false
}

func writeJSON(resp *core_http_response.HTTPResponseHandler, w http.ResponseWriter, r *http.Request, status int, etag string, body any) {
	w.Header().Set("Cache-Control", "no-store")
	if etag != "" {
		w.Header().Set("ETag", etag)
		if r.Method == http.MethodGet && matchesETag(r.Header.Get("If-None-Match"), etag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	resp.JSONResponse(body, status)
}

var ifMatchRe = regexp.MustCompile(`^"r(\d{1,18})"$`)

func parseIfMatch(r *http.Request) (int64, error) {
	raw := strings.TrimSpace(r.Header.Get("If-Match"))
	if raw == "" {
		return 0, fmt.Errorf("If-Match header is required: %w", core_errors.ErrPreconditionRequired)
	}
	m := ifMatchRe.FindStringSubmatch(raw)
	if m == nil {
		return 0, fmt.Errorf(`If-Match must look like "r42": %w`, core_errors.ErrInvalidArgument)
	}
	rev, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0, fmt.Errorf(`If-Match must look like "r42": %w`, core_errors.ErrInvalidArgument)
	}
	return rev, nil
}

func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return err
		}
		return fmt.Errorf("invalid JSON body: %v: %w", err, core_errors.ErrInvalidArgument)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return err
		}
		return fmt.Errorf("unexpected data after the JSON body: %w", core_errors.ErrInvalidArgument)
	}
	return nil
}
