package catalog_admin_transport_http

import (
	"net/http"

	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
)

const (
	smallBodyLimit     = 32 << 10
	changesetBodyLimit = 4 << 20
)

func (h *Handler) Routes() []core_http_server.Route {
	small := []core_http_middleware.Middleware{core_http_middleware.LimitBody(smallBodyLimit)}
	large := []core_http_middleware.Middleware{core_http_middleware.LimitBody(changesetBodyLimit)}
	return []core_http_server.Route{
		{Method: http.MethodGet, Path: "/admin/deck", Handler: h.GetDeck, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/cards", Handler: h.ListCards, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/cards/{id}", Handler: h.GetCard, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/cards/{id}/versions", Handler: h.ListCardVersions, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/cards/{id}/versions/{v}", Handler: h.GetCardVersion, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/changes", Handler: h.ListChanges, Middleware: small},
		{Method: http.MethodPost, Path: "/admin/changesets/validate", Handler: h.ValidateChangeset, Middleware: large},
		{Method: http.MethodPost, Path: "/admin/changesets", Handler: h.ApplyChangeset, Middleware: large},
		{Method: http.MethodGet, Path: "/admin/revisions", Handler: h.ListRevisions, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/revisions/{rev}", Handler: h.GetRevision, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/revisions/{rev}/export", Handler: h.ExportRevision, Middleware: small},
		{Method: http.MethodPost, Path: "/admin/revisions/{rev}/revert-draft", Handler: h.RevertDraft, Middleware: small},
		{Method: http.MethodGet, Path: "/admin/export", Handler: h.ExportCurrent, Middleware: small},
	}
}
