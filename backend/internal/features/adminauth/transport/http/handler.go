package adminauth_transport_http

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
)

type Sessions interface {
	Login(ctx context.Context, ip, userAgent, password string) (string, time.Time, error)
	Logout(ctx context.Context, token string) error
}

type Handler struct {
	sessions Sessions
	guard    *Guard
}

func New(sessions Sessions, guard *Guard) *Handler {
	return &Handler{sessions: sessions, guard: guard}
}

type loginRequest struct {
	Password string `json:"password"`
}

type sessionDTO struct {
	ExpiresAt time.Time `json:"expiresAt"`
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request) *core_http_response.HTTPResponseHandler {
	return core_http_response.NewHTTPResponseHandler(core_logger.FromContext(r.Context()), w, r.Header.Get("X-Request-ID"))
}

func (h *Handler) Routes() []core_http_server.Route {
	limit := core_http_middleware.LimitBody(32 << 10)
	common := []core_http_middleware.Middleware{h.guard.NoStore(), limit}
	withAuth := append(append([]core_http_middleware.Middleware{}, common...), h.guard.RequireAdmin())
	withOrigin := append(append([]core_http_middleware.Middleware{}, common...), h.guard.CheckOrigin())
	return []core_http_server.Route{
		{Method: http.MethodPost, Path: "/admin/session", Handler: h.Login, Middleware: withOrigin},
		{Method: http.MethodGet, Path: "/admin/session", Handler: h.Check, Middleware: withAuth},
		{Method: http.MethodDelete, Path: "/admin/session", Handler: h.Logout, Middleware: withAuth},
	}
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	var req loginRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		resp.ErrorResponse(fmt.Errorf("decode login body: %w: %w", core_errors.ErrInvalidArgument, err), "invalid request body")
		return
	}

	ip := ClientIP(r, h.guard.Trusted())
	token, expires, err := h.sessions.Login(r.Context(), ip, r.UserAgent(), req.Password)
	if err != nil {
		resp.ErrorResponse(err, "invalid password or too many attempts")
		return
	}
	http.SetCookie(w, h.guard.SessionCookie(token, expires))
	resp.JSONResponse(sessionDTO{ExpiresAt: expires}, http.StatusOK)
}

func (h *Handler) Check(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	session, ok := SessionExpiry(r.Context())
	if !ok {
		resp.ErrorResponse(core_errors.ErrUnauthenticated, "not signed in")
		return
	}
	resp.JSONResponse(sessionDTO{ExpiresAt: session.ExpiresAt}, http.StatusOK)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	resp := h.respond(w, r)
	if cookie, err := r.Cookie(CookieName); err == nil {
		if err := h.sessions.Logout(r.Context(), cookie.Value); err != nil {
			resp.ErrorResponse(err, "logout")
			return
		}
	}
	http.SetCookie(w, h.guard.ClearCookie())
	w.WriteHeader(http.StatusNoContent)
}

func DisabledHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		log := core_logger.FromContext(r.Context())
		core_http_response.NewHTTPResponseHandler(log, w, r.Header.Get("X-Request-ID")).
			ErrorResponse(core_errors.ErrNotFound, "admin is disabled")
	})
}
