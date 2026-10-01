package catalog_transport_http

import "net/http"

func (h *Handler) CreateCard(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	var in createCardRequest
	if err := decodeJSON(r, &in); err != nil {
		resp.ErrorResponse(err, "invalid card")
		return
	}

	card, err := h.svc.CreateCard(r.Context(), in.DeckID, in.card())
	if err != nil {
		resp.ErrorResponse(err, "create card")
		return
	}
	resp.JSONResponse(cardFromDomain(card), http.StatusCreated)
}
