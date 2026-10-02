package core_http_server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *HTTPServer) RegisterStatic(dir string) error {
	if dir == "" {
		return nil
	}
	index, assets, err := staticHandlers(dir)
	if err != nil {
		return err
	}
	// Exact paths only. A catch-all GET / conflicts with /api/v1/ in Go 1.22+.
	s.mux.Handle("GET /{$}", index)
	s.mux.Handle("GET /assets/", assets)
	return nil
}

func staticHandlers(dir string) (index, assets http.Handler, err error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, nil, fmt.Errorf("static dir: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, nil, fmt.Errorf("static dir: %w", err)
	}
	if !info.IsDir() {
		return nil, nil, fmt.Errorf("static dir: %s is not a directory", abs)
	}
	indexPath := filepath.Join(abs, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return nil, nil, fmt.Errorf("static dir: %w", err)
	}
	assetsDir := filepath.Join(abs, "assets")
	info, err = os.Stat(assetsDir)
	if err != nil {
		return nil, nil, fmt.Errorf("static dir: %w", err)
	}
	if !info.IsDir() {
		return nil, nil, fmt.Errorf("static dir: %s is not a directory", assetsDir)
	}

	files := http.FileServer(http.Dir(assetsDir))
	index = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, indexPath)
	})
	assets = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/assets/")
		if rel == "" || strings.HasSuffix(rel, "/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.StripPrefix("/assets/", files).ServeHTTP(w, r)
	})
	return index, assets, nil
}
