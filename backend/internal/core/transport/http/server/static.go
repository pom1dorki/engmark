package core_http_server

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *HTTPServer) RegisterStatic(dir string) error {
	if dir == "" {
		return nil
	}
	abs, root, err := staticRoot(dir)
	if err != nil {
		return err
	}
	s.mux.Handle("GET /{$}", indexHandler(root))
	s.mux.Handle("GET /index.html", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusMovedPermanently)
	}))
	s.mux.Handle("GET /assets/", assetsHandler(root))

	entries, err := os.ReadDir(abs)
	if err != nil {
		return fmt.Errorf("static dir: %w", err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if name == "index.html" || name == "assets" || entry.IsDir() || !entry.Type().IsRegular() {
			continue
		}
		fileName := name
		s.mux.Handle("GET /"+fileName, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Cache-Control", "public, max-age=86400")
			http.ServeFileFS(w, r, root, fileName)
		}))
	}
	return nil
}

func staticRoot(dir string) (string, fs.FS, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", nil, fmt.Errorf("static dir: %w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", nil, fmt.Errorf("static dir: %w", err)
	}
	if !info.IsDir() {
		return "", nil, fmt.Errorf("static dir: %s is not a directory", abs)
	}
	root := os.DirFS(abs)
	if _, err := fs.Stat(root, "index.html"); err != nil {
		return "", nil, fmt.Errorf("static dir: %w", err)
	}
	info, err = fs.Stat(root, "assets")
	if err != nil {
		return "", nil, fmt.Errorf("static dir: %w", err)
	}
	if !info.IsDir() {
		return "", nil, fmt.Errorf("static dir: %s is not a directory", filepath.Join(abs, "assets"))
	}
	return abs, root, nil
}

func indexHandler(root fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, root, "index.html")
	})
}

func assetsHandler(root fs.FS) http.Handler {
	assets, err := fs.Sub(root, "assets")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "assets unavailable", http.StatusInternalServerError)
		})
	}
	files := http.FileServerFS(assets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/assets/")
		if rel == "" || strings.HasSuffix(rel, "/") || strings.Contains(rel, "..") || strings.Contains(rel, "\\") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.StripPrefix("/assets/", files).ServeHTTP(w, r)
	})
}

func staticHandlers(dir string) (index, assets http.Handler, err error) {
	_, root, err := staticRoot(dir)
	if err != nil {
		return nil, nil, err
	}
	return indexHandler(root), assetsHandler(root), nil
}
