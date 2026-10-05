package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestRunCommand(t *testing.T) {
	if code := runCommand([]string{"nope"}); code != 2 {
		t.Fatalf("unknown command = %d", code)
	}
	if code := runCommand([]string{"ready", "extra"}); code != 2 {
		t.Fatalf("ready extra = %d", code)
	}
}

func TestReadyURL(t *testing.T) {
	tests := []struct {
		name string
		addr string
		want string
	}{
		{name: "default", addr: "", want: "http://127.0.0.1:8080/readyz"},
		{name: "port only", addr: ":5050", want: "http://127.0.0.1:5050/readyz"},
		{name: "all interfaces", addr: "0.0.0.0:8080", want: "http://127.0.0.1:8080/readyz"},
		{name: "ipv6 all interfaces", addr: "[::]:8080", want: "http://127.0.0.1:8080/readyz"},
		{name: "localhost", addr: "localhost:8080", want: "http://localhost:8080/readyz"},
		{name: "explicit", addr: "127.0.0.1:9090", want: "http://127.0.0.1:9090/readyz"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("HTTP_ADDR", tt.addr)
			got, err := readyURL()
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("readyURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCheckReady(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/readyz" {
			t.Errorf("path = %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(ok.Close)
	okURL, err := url.Parse(ok.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HTTP_ADDR", okURL.Host)
	if err := checkReady(); err != nil {
		t.Fatal(err)
	}

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(bad.Close)
	badURL, err := url.Parse(bad.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HTTP_ADDR", badURL.Host)
	if err := checkReady(); err == nil {
		t.Fatal("expected status error")
	}
}
