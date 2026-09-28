package health_transport_http

import (
	"net/http"

	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
)

func (h *Handler) Routes() []core_http_server.Route {
	return []core_http_server.Route{
		{
			Method:  http.MethodGet,
			Path:    "/healthz",
			Handler: h.HandleLivez,
		},
		{
			Method:  http.MethodGet,
			Path:    "/readyz",
			Handler: h.HandleReadyz,
		},
	}
}
