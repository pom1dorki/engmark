package catalog_admin_transport_http

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (h *Handler) GetDeck(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	s, err := h.admin.DeckSummary(r.Context())
	if err != nil {
		resp.ErrorResponse(err, "get deck")
		return
	}
	writeJSON(resp, w, r, http.StatusOK, revisionETag(s.Revision), DeckDTO{
		ID: s.ID, Slug: s.Slug, Title: s.Title, Revision: s.Revision,
		ActiveCards: s.ActiveCards, ArchivedCards: s.ArchivedCards,
	})
}

func (h *Handler) ListCards(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	limit, err := core_http_request.GetIntQueryParam(r, "limit")
	if err != nil {
		resp.ErrorResponse(err, "invalid limit")
		return
	}
	offset, err := core_http_request.GetIntQueryParam(r, "offset")
	if err != nil {
		resp.ErrorResponse(err, "invalid offset")
		return
	}
	q := r.URL.Query()
	f := catalog_domain.CardFilter{Query: q.Get("q"), Pos: q.Get("pos"), State: q.Get("state")}
	if limit != nil {
		f.Limit = *limit
	}
	if offset != nil {
		f.Offset = *offset
	}
	page, err := h.admin.ListCards(r.Context(), f)
	if err != nil {
		resp.ErrorResponse(err, "list cards")
		return
	}
	items := make([]CardDTO, len(page.Items))
	for i, c := range page.Items {
		items[i] = cardDTO(c)
	}
	limitOut := f.Limit
	if limitOut == 0 {
		limitOut = 50
	}
	writeJSON(resp, w, r, http.StatusOK, revisionETag(page.Revision), CardListDTO{
		Revision: page.Revision, Items: items, Total: page.Total, Limit: limitOut, Offset: f.Offset,
	})
}

func (h *Handler) GetCard(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	id, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid card id")
		return
	}
	card, err := h.admin.GetCard(r.Context(), id)
	if err != nil {
		resp.ErrorResponse(err, "get card")
		return
	}
	writeJSON(resp, w, r, http.StatusOK, versionETag(card.Version), cardDTO(card))
}

func (h *Handler) ListCardVersions(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	id, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid card id")
		return
	}
	versions, err := h.admin.ListCardVersions(r.Context(), id)
	if err != nil {
		resp.ErrorResponse(err, "list card versions")
		return
	}
	items := make([]VersionDTO, len(versions))
	for i, v := range versions {
		items[i] = versionDTO(v)
	}
	writeJSON(resp, w, r, http.StatusOK, "", struct {
		Items []VersionDTO `json:"items"`
	}{items})
}

func (h *Handler) GetCardVersion(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	id, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid card id")
		return
	}
	version, err := core_http_request.GetInt64PathValue(r, "v")
	if err != nil {
		resp.ErrorResponse(err, "invalid version")
		return
	}
	v, err := h.admin.GetCardVersion(r.Context(), id, int(version))
	if err != nil {
		resp.ErrorResponse(err, "get card version")
		return
	}
	writeJSON(resp, w, r, http.StatusOK, "", versionDTO(v))
}

func (h *Handler) ListChanges(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	since, err := core_http_request.GetIntQueryParam(r, "since")
	if err != nil {
		resp.ErrorResponse(err, "invalid since")
		return
	}
	if since == nil {
		resp.ErrorResponse(fmt.Errorf("query since is required: %w", core_errors.ErrInvalidArgument), "invalid since")
		return
	}
	changes, err := h.admin.ListChangesSince(r.Context(), int64(*since))
	if err != nil {
		resp.ErrorResponse(err, "list changes")
		return
	}
	out := ChangesDTO{Revision: changes.Revision, Since: changes.Since, Items: make([]ChangeDTO, len(changes.Items))}
	for i, item := range changes.Items {
		out.Items[i] = ChangeDTO{Current: cardDTO(item.Current)}
		if item.Base != nil {
			v := versionDTO(*item.Base)
			out.Items[i].Base = &v
		}
	}
	writeJSON(resp, w, r, http.StatusOK, "", out)
}

func (h *Handler) ValidateChangeset(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	var body ChangesetDTO
	if err := decodeJSON(r, &body); err != nil {
		resp.ErrorResponse(err, "invalid changeset")
		return
	}
	report, err := h.admin.ValidateChangeset(r.Context(), body.toDomain())
	if err != nil {
		resp.ErrorResponse(err, "validate changeset")
		return
	}
	writeJSON(resp, w, r, http.StatusOK, "", report)
}

func (h *Handler) ApplyChangeset(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	ifMatch, err := parseIfMatch(r)
	if err != nil {
		resp.ErrorResponse(err, "If-Match required")
		return
	}
	var body ChangesetDTO
	if err := decodeJSON(r, &body); err != nil {
		resp.ErrorResponse(err, "invalid changeset")
		return
	}
	if body.BaseRevision != ifMatch {
		resp.ErrorResponse(fmt.Errorf("If-Match r%d does not match baseRevision %d: %w", ifMatch, body.BaseRevision, core_errors.ErrInvalidArgument), "invalid changeset")
		return
	}
	result, err := h.admin.ApplyChangeset(r.Context(), body.toDomain())
	if err != nil {
		resp.ErrorResponse(err, "apply changeset")
		return
	}
	writeJSON(resp, w, r, http.StatusCreated, revisionETag(result.Revision), result)
}

func (h *Handler) ListRevisions(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	limit, err := core_http_request.GetIntQueryParam(r, "limit")
	if err != nil {
		resp.ErrorResponse(err, "invalid limit")
		return
	}
	before, err := core_http_request.GetIntQueryParam(r, "before")
	if err != nil {
		resp.ErrorResponse(err, "invalid before")
		return
	}
	var l int
	var b int64
	if limit != nil {
		l = *limit
	}
	if before != nil {
		b = int64(*before)
	}
	revs, err := h.admin.ListRevisions(r.Context(), l, b)
	if err != nil {
		resp.ErrorResponse(err, "list revisions")
		return
	}
	items := make([]RevisionDTO, len(revs))
	for i, rev := range revs {
		items[i] = revisionDTO(rev)
	}
	writeJSON(resp, w, r, http.StatusOK, "", struct {
		Items []RevisionDTO `json:"items"`
	}{items})
}

func (h *Handler) GetRevision(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	rev, err := core_http_request.GetInt64PathValue(r, "rev")
	if err != nil {
		resp.ErrorResponse(err, "invalid revision")
		return
	}
	detail, err := h.admin.GetRevision(r.Context(), rev)
	if err != nil {
		resp.ErrorResponse(err, "get revision")
		return
	}
	out := RevisionDetailDTO{RevisionDTO: revisionDTO(detail.Revision), Changes: make([]RevisionChangeDTO, len(detail.Changes))}
	for i, c := range detail.Changes {
		out.Changes[i] = RevisionChangeDTO{CardID: c.CardID, Version: c.Version, Kind: c.Kind, Word: c.Word, Translation: c.Translation}
	}
	writeJSON(resp, w, r, http.StatusOK, "", out)
}

func (h *Handler) RevertDraft(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	rev, err := core_http_request.GetInt64PathValue(r, "rev")
	if err != nil {
		resp.ErrorResponse(err, "invalid revision")
		return
	}
	cs, err := h.admin.RevertDraft(r.Context(), rev)
	if err != nil {
		resp.ErrorResponse(err, "build revert draft")
		return
	}
	writeJSON(resp, w, r, http.StatusOK, "", changesetDTO(cs))
}

func (h *Handler) ExportCurrent(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, nil)
}

func (h *Handler) ExportRevision(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	rev, err := core_http_request.GetInt64PathValue(r, "rev")
	if err != nil {
		resp.ErrorResponse(err, "invalid revision")
		return
	}
	h.export(w, r, &rev)
}

func (h *Handler) export(w http.ResponseWriter, r *http.Request, rev *int64) {
	resp := h.respond(w, r)
	state, err := h.admin.Export(r.Context(), rev)
	if err != nil {
		resp.ErrorResponse(err, "export deck")
		return
	}
	cards := make([]catalog_domain.CardData, len(state.Cards))
	for i, c := range state.Cards {
		cards[i] = c.Data
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(cards); err != nil {
		resp.ErrorResponse(err, "encode export")
		return
	}

	etag := revisionETag(state.Revision)
	h2 := w.Header()
	h2.Set("Cache-Control", "no-store")
	h2.Set("ETag", etag)
	if r.Method == http.MethodGet && matchesETag(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h2.Set("Content-Type", "application/json; charset=utf-8")
	h2.Set("Content-Disposition", `attachment; filename="engmark-r`+strconv.FormatInt(state.Revision, 10)+`.json"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}
