package core_http_response

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
)

func TestCachedJSONRevalidates(t *testing.T) {
	log := testLogger(t)
	body := map[string]int{"n": 1}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/cards", nil)
	NewHTTPResponseHandler(log, rec, "req").CachedJSON(req, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	etag := rec.Header().Get("ETag")
	if !strings.HasPrefix(etag, `W/"`) || !strings.HasSuffix(etag, `"`) {
		t.Fatalf("etag = %q", etag)
	}
	if rec.Header().Get("Cache-Control") != catalogCacheControl {
		t.Fatalf("cache = %q", rec.Header().Get("Cache-Control"))
	}
	if rec.Body.Len() == 0 {
		t.Fatal("empty body")
	}

	for _, match := range []string{etag, strings.TrimPrefix(etag, "W/"), "*"} {
		again := httptest.NewRecorder()
		conditional := httptest.NewRequest(http.MethodGet, "/cards", nil)
		conditional.Header.Set("If-None-Match", match)
		NewHTTPResponseHandler(log, again, "req").CachedJSON(conditional, body)
		if again.Code != http.StatusNotModified {
			t.Fatalf("If-None-Match %q = %d", match, again.Code)
		}
		if again.Body.Len() != 0 {
			t.Fatalf("If-None-Match %q body = %q", match, again.Body.String())
		}
		if again.Header().Get("ETag") != etag {
			t.Fatalf("304 etag = %q", again.Header().Get("ETag"))
		}
	}

	other := httptest.NewRecorder()
	miss := httptest.NewRequest(http.MethodGet, "/cards", nil)
	miss.Header.Set("If-None-Match", `W/"different"`)
	NewHTTPResponseHandler(log, other, "req").CachedJSON(miss, body)
	if other.Code != http.StatusOK {
		t.Fatalf("miss = %d", other.Code)
	}

	changed := httptest.NewRecorder()
	NewHTTPResponseHandler(log, changed, "req").CachedJSON(req, map[string]int{"n": 2})
	if changed.Header().Get("ETag") == etag {
		t.Fatal("etag did not change with the body")
	}
}

func testLogger(t *testing.T) *core_logger.Logger {
	t.Helper()
	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	return log
}
