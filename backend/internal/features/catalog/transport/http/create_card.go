package catalog_transport_http

import "net/http"

// CreateCard godoc
// @Summary Create card
// @Tags admin
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateCardRequest true "card without id and version"
// @Success 201 {object} CardDTO
// @Failure 400 {object} core_http_response.ErrorEnvelope
// @Failure 401 {object} core_http_response.ErrorEnvelope
// @Failure 409 {object} core_http_response.ErrorEnvelope
// @Router /api/v1/admin/cards [post]
func (h *Handler) CreateCard(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	var in CreateCardRequest
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
