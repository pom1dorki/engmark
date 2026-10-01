package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

// ListCards godoc
// @Summary List cards
// @Tags catalog
// @Produce json
// @Param limit query int false "max 100"
// @Param offset query int false "offset"
// @Param deck_id query int false "deck id"
// @Success 200 {object} CardListDTO
// @Failure 400 {object} core_http_response.ErrorEnvelope
// @Router /api/v1/cards [get]
func (h *Handler) ListCards(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

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
	deckID, err := core_http_request.GetInt64QueryParam(r, "deck_id")
	if err != nil {
		resp.ErrorResponse(err, "invalid deck_id")
		return
	}

	list, err := h.svc.ListCards(r.Context(), deckID, limit, offset)
	if err != nil {
		resp.ErrorResponse(err, "list cards")
		return
	}
	resp.JSONResponse(cardListFromService(list), http.StatusOK)
}
