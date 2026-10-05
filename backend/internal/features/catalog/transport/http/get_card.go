package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

func (h *Handler) GetCard(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)

	id, err := core_http_request.GetInt64PathValue(r, "id")
	if err != nil {
		resp.ErrorResponse(err, "invalid card id")
		return
	}

	card, err := h.catalog.GetCard(r.Context(), id)
	if err != nil {
		resp.ErrorResponse(err, "get card")
		return
	}
	resp.JSONResponse(cardFromDomain(card), http.StatusOK)
}
