package core_http_server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
)

func TestStaticFiles(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "dist")
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("study"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("js"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "favicon.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}

	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewHTTPServer(Config{Addr: "127.0.0.1:0"}, log)
	if err := server.RegisterStatic(dir); err != nil {
		t.Fatal(err)
	}
	server.RegisterRoutes(Route{
		Method: http.MethodGet,
		Path:   "/healthz",
		Handler: func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		},
	})
	server.mux.Handle("/api/v1/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("cards"))
	}))

	index := requestStatic(t, server, http.MethodGet, "/")
	if index.Code != http.StatusOK || index.Body.String() != "study" {
		t.Fatalf("index = %d %q", index.Code, index.Body.String())
	}
	if index.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("index cache = %q", index.Header().Get("Cache-Control"))
	}
	if index.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}

	icon := requestStatic(t, server, http.MethodGet, "/favicon.svg")
	if icon.Code != http.StatusOK || icon.Body.String() != "<svg/>" {
		t.Fatalf("icon = %d %q", icon.Code, icon.Body.String())
	}
	if icon.Header().Get("Cache-Control") != "public, max-age=86400" {
		t.Fatalf("icon cache = %q", icon.Header().Get("Cache-Control"))
	}
	moved := requestStatic(t, server, http.MethodGet, "/index.html")
	if moved.Code != http.StatusMovedPermanently || moved.Header().Get("Location") != "/" {
		t.Fatalf("index.html = %d %q", moved.Code, moved.Header().Get("Location"))
	}
	escape := requestStatic(t, server, http.MethodGet, "/assets/../index.html")
	if escape.Body.String() == "study" && escape.Code == http.StatusOK {
		t.Fatal("asset path escaped the assets directory")
	}

	asset := requestStatic(t, server, http.MethodGet, "/assets/app.js")
	if asset.Code != http.StatusOK || asset.Body.String() != "js" {
		t.Fatalf("asset = %d %q", asset.Code, asset.Body.String())
	}
	if asset.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset cache = %q", asset.Header().Get("Cache-Control"))
	}

	missing := requestStatic(t, server, http.MethodGet, "/assets/missing.js")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing asset = %d", missing.Code)
	}

	other := requestStatic(t, server, http.MethodGet, "/cards/2")
	if other.Code != http.StatusNotFound {
		t.Fatalf("unknown path = %d", other.Code)
	}

	swagger := requestStatic(t, server, http.MethodGet, "/swagger/index.html")
	if swagger.Code != http.StatusNotFound {
		t.Fatalf("swagger = %d", swagger.Code)
	}

	cards := requestStatic(t, server, http.MethodGet, "/api/v1/cards?limit=100")
	if cards.Code != http.StatusOK || cards.Body.String() != "cards" {
		t.Fatalf("cards = %d %q", cards.Code, cards.Body.String())
	}

	health := requestStatic(t, server, http.MethodGet, "/healthz")
	if health.Code != http.StatusNoContent || health.Body.Len() != 0 {
		t.Fatalf("healthz = %d %q", health.Code, health.Body.String())
	}

	head := requestStatic(t, server, http.MethodHead, "/")
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("head = %d body %d", head.Code, head.Body.Len())
	}
}

func TestStaticManifest(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "dist")
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("study"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.webmanifest"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewHTTPServer(Config{Addr: "127.0.0.1:0"}, log)
	if err := server.RegisterStatic(dir); err != nil {
		t.Fatal(err)
	}

	res := requestStatic(t, server, http.MethodGet, "/manifest.webmanifest")
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d", res.Code)
	}
	if got := res.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/manifest+json") {
		t.Fatalf("content-type = %q", got)
	}
}

func TestStaticHidesCSPFile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "dist")
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("study"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "csp.txt"), []byte("sha256-test"), 0o644); err != nil {
		t.Fatal(err)
	}

	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewHTTPServer(Config{Addr: "127.0.0.1:0"}, log)
	if err := server.RegisterStatic(dir); err != nil {
		t.Fatal(err)
	}

	res := requestStatic(t, server, http.MethodGet, "/csp.txt")
	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d", res.Code)
	}
}

func TestStaticRejectsMissingIndex(t *testing.T) {
	if _, _, err := staticHandlers(t.TempDir()); err == nil {
		t.Fatal("expected error")
	}
}

func requestStatic(t *testing.T, server *HTTPServer, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}
