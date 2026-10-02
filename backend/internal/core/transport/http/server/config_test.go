package core_http_server

import (
	"os"
	"testing"
)

func TestSwaggerDefaultsOn(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":5050")
	t.Setenv("HTTP_ALLOWED_ORIGINS", "http://localhost:5173")
	t.Setenv("HTTP_SHUTDOWN_TIMEOUT", "30s")
	withoutEnv(t, "HTTP_SWAGGER")
	withoutEnv(t, "HTTP_STATIC_DIR")

	cfg, err := NewConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Swagger {
		t.Fatal("swagger default is off")
	}
	if cfg.StaticDir != "" {
		t.Fatalf("static dir = %q", cfg.StaticDir)
	}
}

func TestSwaggerCanBeDisabled(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":8080")
	t.Setenv("HTTP_ALLOWED_ORIGINS", "https://words.example.com")
	t.Setenv("HTTP_SWAGGER", "false")
	t.Setenv("HTTP_STATIC_DIR", "/srv/engmark")

	cfg, err := NewConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Swagger {
		t.Fatal("swagger stayed on")
	}
	if cfg.StaticDir != "/srv/engmark" {
		t.Fatalf("static dir = %q", cfg.StaticDir)
	}
}

func withoutEnv(t *testing.T, key string) {
	t.Helper()
	value, ok := os.LookupEnv(key)
	if err := os.Unsetenv(key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if ok {
			os.Setenv(key, value)
		} else {
			os.Unsetenv(key)
		}
	})
}
