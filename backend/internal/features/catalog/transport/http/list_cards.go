package catalog_transport_http

import (
	"net/http"

	core_http_request "github.com/pom1dorki/engmark/internal/core/transport/http/request"
)

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

	page, err := h.catalog.ListCards(r.Context(), limit, offset)
	if err != nil {
		resp.ErrorResponse(err, "list cards")
		return
	}
	writeCardPage(resp, r, page)
}
