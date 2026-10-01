package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

// GetCard godoc
// @Summary Get card
// @Tags catalog
// @Produce json
// @Param id path int true "card id"
// @Success 200 {object} CardDTO
// @Failure 400 {object} core_http_response.ErrorEnvelope
// @Failure 404 {object} core_http_response.ErrorEnvelope
// @Router /api/v1/cards/{id} [get]
func (h *Handler) GetCard(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	id, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid card id")
		return
	}

	card, err := h.svc.GetCard(r.Context(), id)
	if err != nil {
		resp.ErrorResponse(err, "get card")
		return
	}
	resp.JSONResponse(cardFromDomain(card), http.StatusOK)
}
