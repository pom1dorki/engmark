package health_transport_http

import (
	"net/http"

	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
)

func Routes() []core_http_server.Route {
	return []core_http_server.Route{
		{
			Method:  http.MethodGet,
			Path:    "/healthz",
			Handler: HandleLivez,
		},
		{
			Method:  http.MethodGet,
			Path:    "/readyz",
			Handler: HandleReadyz,
		},
	}
}
