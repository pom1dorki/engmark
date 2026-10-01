package catalog_transport_http

import "net/http"

func (h *Handler) ListDecks(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	decks, err := h.svc.ListDecks(r.Context())
	if err != nil {
		resp.ErrorResponse(err, "list decks")
		return
	}

	items := make([]deckDTO, 0, len(decks))
	for _, d := range decks {
		items = append(items, deckFromDomain(d))
	}
	resp.JSONResponse(items, http.StatusOK)
}
