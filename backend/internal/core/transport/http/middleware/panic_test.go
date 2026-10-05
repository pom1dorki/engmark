package core_http_middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func testLog(level zapcore.Level) (*core_logger.Logger, *observer.ObservedLogs) {
	core, logs := observer.New(level)
	return &core_logger.Logger{Logger: zap.New(core)}, logs
}

func TestPanicWritesJSONUntilCommitted(t *testing.T) {
	log, logs := testLog(zapcore.DebugLevel)
	handler := ChainMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}), Trace(), Panic())
	req := httptest.NewRequest(http.MethodGet, "/cards", nil)
	req = req.WithContext(core_logger.ToContext(req.Context(), log))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("empty panic body")
	}
	if logs.FilterMessage("during handle HTTP request got unexpected panic").Len() != 1 {
		t.Fatalf("logs = %v", logs.All())
	}

	started := ChainMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		panic("late")
	}), Trace(), Panic())
	rec = httptest.NewRecorder()
	started.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "ok" {
		t.Fatalf("committed = %d %q", rec.Code, rec.Body.String())
	}
}

func TestPanicRethrowsAbort(t *testing.T) {
	log, _ := testLog(zapcore.ErrorLevel)
	handler := Panic()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(http.ErrAbortHandler)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(core_logger.ToContext(req.Context(), log))
	defer func() {
		if recover() != http.ErrAbortHandler {
			t.Fatal("abort was swallowed")
		}
	}()
	handler.ServeHTTP(httptest.NewRecorder(), req)
}

func TestTraceHealthAndBytes(t *testing.T) {
	log, logs := testLog(zapcore.DebugLevel)
	handler := Trace()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte("abc"))
	}))
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req = req.WithContext(core_logger.ToContext(req.Context(), log))
	handler.ServeHTTP(httptest.NewRecorder(), req)

	ready := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	ready = ready.WithContext(core_logger.ToContext(ready.Context(), log))
	handler.ServeHTTP(httptest.NewRecorder(), ready)

	cards := httptest.NewRequest(http.MethodGet, "/api/v1/cards", nil)
	cards = cards.WithContext(core_logger.ToContext(cards.Context(), log))
	handler.ServeHTTP(httptest.NewRecorder(), cards)

	var sawDebug, sawWarn, sawInfo bool
	for _, entry := range logs.All() {
		if entry.Message != "HTTP request" {
			continue
		}
		fields := entry.ContextMap()
		switch fields["path"] {
		case "/healthz":
			if entry.Level != zapcore.DebugLevel || fields["bytes"] != int64(3) && fields["bytes"] != 3 {
				t.Fatalf("health log %+v", fields)
			}
			sawDebug = true
		case "/readyz":
			if entry.Level != zapcore.WarnLevel {
				t.Fatalf("ready level %s", entry.Level)
			}
			sawWarn = true
		case "/api/v1/cards":
			if entry.Level != zapcore.InfoLevel {
				t.Fatalf("cards level %s", entry.Level)
			}
			sawInfo = true
		}
	}
	if !sawDebug || !sawWarn || !sawInfo {
		t.Fatalf("logs = %v", logs.All())
	}
}

func TestFromContextWithoutLogger(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if core_logger.FromContext(req.Context()) == nil {
		t.Fatal("nil fallback logger")
	}
}
