package catalog_transport_http

import "net/http"

// ListDecks godoc
// @Summary List decks
// @Tags catalog
// @Produce json
// @Success 200 {array} DeckDTO
// @Failure 500 {object} core_http_response.ErrorEnvelope
// @Router /api/v1/decks [get]
func (h *Handler) ListDecks(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	decks, err := h.svc.ListDecks(r.Context())
	if err != nil {
		resp.ErrorResponse(err, "list decks")
		return
	}

	items := make([]DeckDTO, 0, len(decks))
	for _, d := range decks {
		items = append(items, deckFromDomain(d))
	}
	resp.JSONResponse(items, http.StatusOK)
}
