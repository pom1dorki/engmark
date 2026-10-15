package core_http_server

import (
	"net/http"

	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
)

type Route struct {
	Method     string
	Path       string
	Handler    http.HandlerFunc
	Middleware []core_http_middleware.Middleware
}

func (r *Route) WithMiddleware() http.Handler {
	return core_http_middleware.ChainMiddleware(r.Handler, r.Middleware...)
}

func WithMiddleware(routes []Route, mw ...core_http_middleware.Middleware) []Route {
	out := make([]Route, len(routes))
	for i, route := range routes {
		route.Middleware = append(append([]core_http_middleware.Middleware{}, mw...), route.Middleware...)
		out[i] = route
	}
	return out
}
