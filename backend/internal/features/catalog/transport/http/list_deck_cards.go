package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

// ListDeckCards godoc
// @Summary List cards in a deck
// @Tags catalog
// @Produce json
// @Param id path int true "deck id"
// @Param limit query int false "max 100"
// @Param offset query int false "offset"
// @Success 200 {object} CardListDTO
// @Failure 400 {object} core_http_response.ErrorEnvelope
// @Router /api/v1/decks/{id}/cards [get]
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

	list, err := h.svc.ListCardsByDeck(r.Context(), deckID, limit, offset)
	if err != nil {
		resp.ErrorResponse(err, "list deck cards")
		return
	}
	resp.JSONResponse(cardListFromService(list), http.StatusOK)
}
