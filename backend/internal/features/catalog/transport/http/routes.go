package catalog_transport_http

import (
	"net/http"

	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
)

func (h *Handler) Routes() []core_http_server.Route {
	return []core_http_server.Route{
		{Method: http.MethodGet, Path: "/cards", Handler: h.ListCards},
		{Method: http.MethodGet, Path: "/cards/{id}", Handler: h.GetCard},
		{Method: http.MethodGet, Path: "/decks", Handler: h.ListDecks},
		{Method: http.MethodGet, Path: "/decks/{id}/cards", Handler: h.ListDeckCards},
		{
			Method:     http.MethodPost,
			Path:       "/admin/cards",
			Handler:    h.CreateCard,
			Middleware: []core_http_middleware.Middleware{h.adminAuth},
		},
		{
			Method:     http.MethodPatch,
			Path:       "/admin/cards/{id}",
			Handler:    h.PatchCard,
			Middleware: []core_http_middleware.Middleware{h.adminAuth},
		},
		{
			Method:     http.MethodDelete,
			Path:       "/admin/cards/{id}",
			Handler:    h.DeleteCard,
			Middleware: []core_http_middleware.Middleware{h.adminAuth},
		},
	}
}
