package core_http_server

import (
	"os"
	"testing"
)

func TestHTTPConfigStaticDir(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":5050")
	withoutEnv(t, "HTTP_STATIC_DIR")

	cfg, err := NewConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.StaticDir != "" {
		t.Fatalf("static dir = %q", cfg.StaticDir)
	}

	t.Setenv("HTTP_STATIC_DIR", "/srv/engmark")
	cfg, err = NewConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.StaticDir != "/srv/engmark" {
		t.Fatalf("static dir = %q", cfg.StaticDir)
	}
}

func TestHTTPTimeoutDefaults(t *testing.T) {
	t.Setenv("HTTP_ADDR", ":5050")
	for _, key := range []string{"HTTP_READ_HEADER_TIMEOUT", "HTTP_READ_TIMEOUT", "HTTP_WRITE_TIMEOUT", "HTTP_IDLE_TIMEOUT", "HTTP_MAX_HEADER_BYTES"} {
		withoutEnv(t, key)
	}
	cfg, err := NewConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ReadHeaderTimeout != readHeaderTimeout || cfg.ReadTimeout != readTimeout || cfg.WriteTimeout != writeTimeout || cfg.IdleTimeout != idleTimeout {
		t.Fatalf("timeouts = %+v", cfg)
	}
	if cfg.MaxHeaderBytes != maxHeaderBytes {
		t.Fatalf("max header bytes = %d", cfg.MaxHeaderBytes)
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
