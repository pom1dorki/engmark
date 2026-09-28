package catalog_transport_http

import (
	"net/http"

	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
)

func (h *Handler) Routes() []core_http_server.Route {
	return []core_http_server.Route{
		{Method: http.MethodGet, Path: "/cards", Handler: h.ListCards},
		{Method: http.MethodGet, Path: "/cards/{id}", Handler: h.GetCard},
		{Method: http.MethodGet, Path: "/decks", Handler: h.ListDecks},
		{Method: http.MethodGet, Path: "/decks/{id}/cards", Handler: h.ListDeckCards},
	}
}
