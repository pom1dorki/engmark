package adminauth_transport_http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/netip"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
	adminauth_postgres_repository "github.com/pom1dorki/engmark/internal/features/adminauth/repository/postgres"
	adminauth_service "github.com/pom1dorki/engmark/internal/features/adminauth/service"
	"github.com/pom1dorki/engmark/internal/testkit"
	"golang.org/x/crypto/bcrypt"
)

const password = "correct horse battery"

var (
	pool *pgxpool.Pool
	hash string
)

func TestMain(m *testing.M) {
	var cleanup func()
	var err error
	pool, cleanup, err = testkit.Start(context.Background())
	if err != nil {
		fmt.Fprintf(os.Stderr, "postgres: %v\n", err)
		os.Exit(1)
	}
	raw, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bcrypt: %v\n", err)
		os.Exit(1)
	}
	hash = string(raw)
	code := m.Run()
	cleanup()
	os.Exit(code)
}

type env struct {
	srv    *httptest.Server
	client *http.Client
	svc    *adminauth_service.Service
}

func newEnv(t *testing.T, mutate func(*adminauth_domain.Config)) *env {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `DELETE FROM admin_sessions`); err != nil {
		t.Fatal(err)
	}
	cfg := adminauth_domain.Config{PasswordHash: hash, SessionTTL: time.Hour}
	if mutate != nil {
		mutate(&cfg)
	}
	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	svc := adminauth_service.New(adminauth_postgres_repository.New(pool), cfg, adminauth_service.WithMinLoginLatency(0))
	guard, err := NewGuard(svc, cfg)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := core_http_server.NewHTTPServer(
		core_http_server.Config{Addr: "127.0.0.1:0"}, log,
		core_http_middleware.RequestID(), core_http_middleware.Logger(log), core_http_middleware.Trace(), core_http_middleware.Panic(),
	)
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(New(svc, guard).Routes()...)
	v1.RegisterRoutes(core_http_server.Route{
		Method: http.MethodPost, Path: "/admin/ping",
		Handler:    func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) },
		Middleware: []core_http_middleware.Middleware{guard.NoStore(), guard.RequireAdmin()},
	})
	httpServer.RegisterAPIRouters(v1)
	srv := httptest.NewServer(httpServer.Handler())
	t.Cleanup(srv.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &env{srv: srv, client: &http.Client{Jar: jar}, svc: svc}
}

func (e *env) do(t *testing.T, method, path string, body any, origin string) (*http.Response, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rdr = bytes.NewReader(raw)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func (e *env) login(t *testing.T, pw string) (*http.Response, map[string]any) {
	t.Helper()
	return e.do(t, http.MethodPost, "/api/v1/admin/session", map[string]string{"password": pw}, e.srv.URL)
}

func errCode(body map[string]any) string {
	if e, ok := body["error"].(map[string]any); ok {
		if c, ok := e["code"].(string); ok {
			return c
		}
	}
	return ""
}

func TestLoginCheckLogout(t *testing.T) {
	e := newEnv(t, nil)

	if resp, body := e.do(t, http.MethodGet, "/api/v1/admin/session", nil, ""); resp.StatusCode != http.StatusUnauthorized || errCode(body) != "unauthenticated" {
		t.Fatalf("before login: %d %v", resp.StatusCode, body)
	}

	resp, body := e.login(t, password)
	if resp.StatusCode != http.StatusOK || body["expiresAt"] == nil {
		t.Fatalf("login: %d %v", resp.StatusCode, body)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", resp.Header.Get("Cache-Control"))
	}
	cookies := resp.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %v", cookies)
	}
	c := cookies[0]
	if c.Name != "em_admin" || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/api/v1/admin" || c.MaxAge <= 0 {
		t.Fatalf("cookie = %+v", c)
	}

	if resp, _ := e.do(t, http.MethodGet, "/api/v1/admin/session", nil, ""); resp.StatusCode != http.StatusOK {
		t.Fatalf("check after login: %d", resp.StatusCode)
	}
	var raw int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM admin_sessions WHERE token_hash = convert_to($1, 'UTF8')`, c.Value).Scan(&raw); err != nil || raw != 0 {
		t.Fatalf("raw token stored: %d %v", raw, err)
	}

	if resp, _ := e.do(t, http.MethodDelete, "/api/v1/admin/session", nil, e.srv.URL); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout: %d", resp.StatusCode)
	}
	if resp, _ := e.do(t, http.MethodGet, "/api/v1/admin/session", nil, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("check after logout: %d", resp.StatusCode)
	}
}

func TestCookieSecureFollowsConfig(t *testing.T) {
	e := newEnv(t, func(c *adminauth_domain.Config) { c.CookieSecure = true })
	resp, _ := e.login(t, password)
	if resp.StatusCode != http.StatusOK || len(resp.Cookies()) != 1 || !resp.Cookies()[0].Secure {
		t.Fatalf("login: %d %v", resp.StatusCode, resp.Cookies())
	}
}

func TestWrongPassword(t *testing.T) {
	e := newEnv(t, nil)
	for _, pw := range []string{"wrong", "", strings.Repeat("a", 300)} {
		resp, body := e.login(t, pw)
		if resp.StatusCode != http.StatusUnauthorized || errCode(body) != "unauthenticated" || len(resp.Cookies()) != 0 {
			t.Fatalf("password %q: %d %v", pw, resp.StatusCode, body)
		}
	}
}

func TestLoginRateLimit(t *testing.T) {
	e := newEnv(t, nil)
	for i := 1; i <= 5; i++ {
		if resp, _ := e.login(t, "wrong"); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, resp.StatusCode)
		}
	}
	resp, body := e.login(t, password)
	if resp.StatusCode != http.StatusTooManyRequests || errCode(body) != "too_many_requests" {
		t.Fatalf("after limit: %d %v", resp.StatusCode, body)
	}
}

func TestExpiredSessionIsRejected(t *testing.T) {
	e := newEnv(t, nil)
	if resp, _ := e.login(t, password); resp.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", resp.StatusCode)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE admin_sessions SET expires_at = now() - interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	if resp, _ := e.do(t, http.MethodGet, "/api/v1/admin/session", nil, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired session: %d", resp.StatusCode)
	}
	n, err := adminauth_postgres_repository.New(pool).DeleteExpired(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("cleanup deleted %d, %v", n, err)
	}
}

func TestSessionIsExtendedAtMostOncePerMinute(t *testing.T) {
	e := newEnv(t, nil)
	e.login(t, password)
	if _, err := pool.Exec(context.Background(), `UPDATE admin_sessions SET last_seen_at = now() - interval '5 minutes', expires_at = now() + interval '10 minutes'`); err != nil {
		t.Fatal(err)
	}
	resp, _ := e.do(t, http.MethodGet, "/api/v1/admin/session", nil, "")
	if resp.StatusCode != http.StatusOK || len(resp.Cookies()) != 1 {
		t.Fatalf("renew: %d %v", resp.StatusCode, resp.Cookies())
	}
	var extended bool
	if err := pool.QueryRow(context.Background(), `SELECT expires_at > now() + interval '50 minutes' FROM admin_sessions`).Scan(&extended); err != nil || !extended {
		t.Fatalf("expires_at not extended: %v %v", extended, err)
	}
	if resp, _ := e.do(t, http.MethodGet, "/api/v1/admin/session", nil, ""); len(resp.Cookies()) != 0 {
		t.Fatal("second request within a minute must not renew again")
	}
}

func TestForeignOriginIsForbidden(t *testing.T) {
	e := newEnv(t, nil)
	resp, body := e.do(t, http.MethodPost, "/api/v1/admin/session", map[string]string{"password": password}, "https://evil.example")
	if resp.StatusCode != http.StatusForbidden || errCode(body) != "forbidden_origin" {
		t.Fatalf("login from foreign origin: %d %v", resp.StatusCode, body)
	}
	if resp, body := e.do(t, http.MethodPost, "/api/v1/admin/session", map[string]string{"password": password}, ""); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("login without origin: %d %v", resp.StatusCode, body)
	}

	if resp, _ := e.login(t, password); resp.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", resp.StatusCode)
	}
	if resp, body := e.do(t, http.MethodPost, "/api/v1/admin/ping", nil, "https://evil.example"); resp.StatusCode != http.StatusForbidden || errCode(body) != "forbidden_origin" {
		t.Fatalf("mutation from foreign origin: %d %v", resp.StatusCode, body)
	}
	if resp, _ := e.do(t, http.MethodPost, "/api/v1/admin/ping", nil, e.srv.URL); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("mutation from own origin: %d", resp.StatusCode)
	}
}

func TestAllowedOriginsFromConfig(t *testing.T) {
	e := newEnv(t, func(c *adminauth_domain.Config) { c.AllowedOrigins = []string{"http://localhost:5173/"} })
	resp, _ := e.do(t, http.MethodPost, "/api/v1/admin/session", map[string]string{"password": password}, "http://localhost:5173")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("configured origin: %d", resp.StatusCode)
	}
}

func TestDisabledAdminAnswers404(t *testing.T) {
	log, _ := core_logger.NewLogger(core_logger.Config{Level: "error"})
	httpServer := core_http_server.NewHTTPServer(core_http_server.Config{Addr: "127.0.0.1:0"}, log,
		core_http_middleware.RequestID(), core_http_middleware.Logger(log), core_http_middleware.Trace(), core_http_middleware.Panic())
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.Handle("/admin/", DisabledHandler())
	httpServer.RegisterAPIRouters(v1)
	srv := httptest.NewServer(httpServer.Handler())
	defer srv.Close()

	for _, m := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		req, _ := http.NewRequest(m, srv.URL+"/api/v1/admin/session", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("%s: %d", m, resp.StatusCode)
		}
	}
}

func TestClientIP(t *testing.T) {
	trusted, err := ParseTrustedProxies([]string{"10.0.0.0/8", "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseTrustedProxies([]string{"nonsense"}); err == nil {
		t.Fatal("garbage must be rejected")
	}
	req := func(remote, xff string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remote
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		return r
	}
	tests := []struct {
		name        string
		remote, xff string
		trusted     []netip.Prefix
		want        string
	}{
		{"direct client, header ignored", "203.0.113.9:5000", "1.2.3.4", trusted, "203.0.113.9"},
		{"no trusted list, header ignored", "10.0.0.2:5000", "1.2.3.4", nil, "10.0.0.2"},
		{"trusted proxy, client from header", "10.0.0.2:5000", "198.51.100.7", trusted, "198.51.100.7"},
		{"spoofed left entry is not used", "10.0.0.2:5000", "6.6.6.6, 198.51.100.7", trusted, "198.51.100.7"},
		{"chain of trusted proxies", "10.0.0.2:5000", "198.51.100.7, 10.0.0.9", trusted, "198.51.100.7"},
		{"trusted proxy without header", "10.0.0.2:5000", "", trusted, "10.0.0.2"},
		{"ipv6 mapped", "[::ffff:203.0.113.9]:80", "", trusted, "203.0.113.9"},
	}
	for _, tt := range tests {
		if got := ClientIP(req(tt.remote, tt.xff), tt.trusted); got != tt.want {
			t.Errorf("%s: ClientIP = %q, want %q", tt.name, got, tt.want)
		}
	}
}
