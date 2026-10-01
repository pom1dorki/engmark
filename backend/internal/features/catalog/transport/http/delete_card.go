package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

// DeleteCard godoc
// @Summary Delete card
// @Tags admin
// @Security BearerAuth
// @Param id path int true "card id"
// @Success 204
// @Failure 400 {object} core_http_response.ErrorEnvelope
// @Failure 401 {object} core_http_response.ErrorEnvelope
// @Failure 404 {object} core_http_response.ErrorEnvelope
// @Router /api/v1/admin/cards/{id} [delete]
func (h *Handler) DeleteCard(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	id, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid card id")
		return
	}
	if err := h.svc.DeleteCard(r.Context(), id); err != nil {
		resp.ErrorResponse(err, "delete card")
		return
	}
	resp.NoContentResponse()
}
