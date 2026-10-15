package adminauth_transport_http

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
	adminauth_service "github.com/pom1dorki/engmark/internal/features/adminauth/service"
)

const (
	CookieName = "em_admin"
	cookiePath = "/api/v1/admin"
)

type Authenticator interface {
	Authenticate(ctx context.Context, token string) (adminauth_service.Authenticated, error)
}

type sessionKey struct{}

func SessionExpiry(ctx context.Context) (adminauth_service.Authenticated, bool) {
	v, ok := ctx.Value(sessionKey{}).(adminauth_service.Authenticated)
	return v, ok
}

type Guard struct {
	auth    Authenticator
	cfg     adminauth_domain.Config
	allowed map[string]struct{}
	trusted []netip.Prefix
}

func NewGuard(auth Authenticator, cfg adminauth_domain.Config) (*Guard, error) {
	trusted, err := ParseTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, origin := range cfg.AllowedOrigins {
		if origin = strings.ToLower(strings.TrimRight(strings.TrimSpace(origin), "/")); origin != "" {
			allowed[origin] = struct{}{}
		}
	}
	return &Guard{auth: auth, cfg: cfg, allowed: allowed, trusted: trusted}, nil
}

func (g *Guard) NoStore() core_http_middleware.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
		})
	}
}

func (g *Guard) CheckOrigin() core_http_middleware.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !g.originAllowed(r) {
				fail(w, r, &core_errors.CodedError{
					Err: core_errors.ErrForbidden, Code: "forbidden_origin", Message: "origin is not allowed",
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (g *Guard) RequireAdmin() core_http_middleware.Middleware {
	checkOrigin := g.CheckOrigin()
	return func(next http.Handler) http.Handler {
		authed := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(CookieName)
			if err != nil || cookie.Value == "" {
				fail(w, r, core_errors.ErrUnauthenticated)
				return
			}
			session, err := g.auth.Authenticate(r.Context(), cookie.Value)
			if err != nil {
				fail(w, r, err)
				return
			}
			if session.Renewed {
				http.SetCookie(w, g.SessionCookie(cookie.Value, session.ExpiresAt))
			}
			ctx := context.WithValue(r.Context(), sessionKey{}, session)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
		return checkOrigin(authed)
	}
}

func (g *Guard) SessionCookie(token string, expires time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     cookiePath,
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   g.cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode,
	}
}

func (g *Guard) ClearCookie() *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Path:     cookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   g.cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode,
	}
}

func (g *Guard) Trusted() []netip.Prefix { return g.trusted }

func fail(w http.ResponseWriter, r *http.Request, err error) {
	log := core_logger.FromContext(r.Context())
	core_http_response.NewHTTPResponseHandler(log, w, r.Header.Get("X-Request-ID")).ErrorResponse(err, "request rejected")
}

func (g *Guard) originAllowed(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	origin := strings.ToLower(strings.TrimRight(r.Header.Get("Origin"), "/"))
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") == "same-origin"
	}
	if _, ok := g.allowed[origin]; ok {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host)
}

func ParseTrustedProxies(items []string) ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if prefix, err := netip.ParsePrefix(item); err == nil {
			out = append(out, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(item)
		if err != nil {
			return nil, &net.ParseError{Type: "trusted proxy address or CIDR", Text: item}
		}
		out = append(out, netip.PrefixFrom(addr.Unmap(), addr.Unmap().BitLen()))
	}
	return out, nil
}

func isTrusted(addr netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

func ClientIP(r *http.Request, trusted []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	remote = remote.Unmap()
	if !isTrusted(remote, trusted) {
		return remote.String()
	}
	parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		addr, err := netip.ParseAddr(strings.TrimSpace(parts[i]))
		if err != nil {
			continue
		}
		if addr = addr.Unmap(); !isTrusted(addr, trusted) {
			return addr.String()
		}
	}
	return remote.String()
}
