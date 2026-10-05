package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

func (h *Handler) ListDeckCards(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	deckID, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid deck id")
		return
	}
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

	page, err := h.catalog.ListCardsByDeck(r.Context(), deckID, limit, offset)
	if err != nil {
		resp.ErrorResponse(err, "list deck cards")
		return
	}
	writeCardPage(resp, r, page)
}
