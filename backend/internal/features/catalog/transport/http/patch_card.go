package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

// PatchCard godoc
// @Summary Patch card
// @Tags admin
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "card id"
// @Param body body PatchCardRequest true "version is required"
// @Success 200 {object} CardDTO
// @Failure 400 {object} core_http_response.ErrorEnvelope
// @Failure 401 {object} core_http_response.ErrorEnvelope
// @Failure 404 {object} core_http_response.ErrorEnvelope
// @Failure 409 {object} core_http_response.ErrorEnvelope
// @Router /api/v1/admin/cards/{id} [patch]
func (h *Handler) PatchCard(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	id, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid card id")
		return
	}

	var in PatchCardRequest
	if err := decodeJSON(r, &in); err != nil {
		resp.ErrorResponse(err, "invalid card patch")
		return
	}
	patch, err := in.patch()
	if err != nil {
		resp.ErrorResponse(err, "invalid card patch")
		return
	}

	card, err := h.svc.PatchCard(r.Context(), id, patch)
	if err != nil {
		resp.ErrorResponse(err, "patch card")
		return
	}
	resp.JSONResponse(cardFromDomain(card), http.StatusOK)
}
