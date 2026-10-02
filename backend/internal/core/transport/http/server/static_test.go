package core_http_server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
