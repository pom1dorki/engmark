package catalog_transport_http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_snapshot "github.com/pom1dorki/engmark/internal/features/catalog/snapshot"
	"github.com/pom1dorki/engmark/internal/testkit"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

var (
	srv   *httptest.Server
	pool  *pgxpool.Pool
	store *catalog_snapshot.Store
)

func TestMain(m *testing.M) {
	if benchWithoutTests() {
		os.Exit(m.Run())
	}
	ctx := context.Background()
	var cleanupDB func()
	var err error
	pool, cleanupDB, err = testkit.Start(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "postgres: %v\n", err)
		os.Exit(1)
	}
	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		fmt.Fprintf(os.Stderr, "logger: %v\n", err)
		os.Exit(1)
	}
	httpServer := core_http_server.NewHTTPServer(
		core_http_server.Config{Addr: "127.0.0.1:0"},
		log,
		core_http_middleware.RequestID(),
		core_http_middleware.Logger(log),
		core_http_middleware.Trace(),
		core_http_middleware.Panic(),
		core_http_middleware.LimitBody(32<<10),
	)
	repo := catalog_postgres_repository.New(pool)
	store = catalog_snapshot.New()
	if err := store.Reload(ctx, repo, MarshalCardList); err != nil {
		fmt.Fprintf(os.Stderr, "snapshot: %v\n", err)
		os.Exit(1)
	}
	h := New(store)
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(h.Routes()...)
	httpServer.RegisterAPIRouters(v1)

	srv = httptest.NewServer(httpServer.Handler())
	code := m.Run()
	srv.Close()
	cleanupDB()
	os.Exit(code)
}

func benchWithoutTests() bool {
	var run, bench string
	for _, arg := range os.Args[1:] {
		switch {
		case strings.HasPrefix(arg, "-test.bench="):
			bench = strings.TrimPrefix(arg, "-test.bench=")
		case strings.HasPrefix(arg, "-test.run="):
			run = strings.TrimPrefix(arg, "-test.run=")
		}
	}
	if bench == "" || run == "" {
		return false
	}
	match, err := regexp.Compile(run)
	if err != nil {
		return false
	}
	return !match.MatchString("TestCatalogHTTP")
}

type cardBody struct {
	ID          int64  `json:"id"`
	Version     int    `json:"version"`
	Word        string `json:"word"`
	Translation string `json:"translation"`
}

type cardList struct {
	Items  []cardBody `json:"items"`
	Total  int        `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

type errEnv struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	RequestID string `json:"request_id"`
}

func do(t *testing.T, method, path string, body any) (*http.Response, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res, raw
}

func mustList(t *testing.T) cardList {
	t.Helper()
	res, raw := do(t, http.MethodGet, "/api/v1/cards?limit=100", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list %d: %s", res.StatusCode, raw)
	}
	var list cardList
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func TestListEmpty(t *testing.T) {
	list := mustList(t)
	if list.Total != 0 || len(list.Items) != 0 || list.Limit != 100 || list.Offset != 0 {
		t.Fatalf("list = %+v", list)
	}
}

func TestListRevalidates(t *testing.T) {
	res, raw := do(t, http.MethodGet, "/api/v1/cards?limit=1000", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list %d: %s", res.StatusCode, raw)
	}
	etag := res.Header.Get("ETag")
	if !strings.HasPrefix(etag, `W/"`) {
		t.Fatalf("etag = %q", etag)
	}
	if res.Header.Get("Cache-Control") != "public, max-age=0, must-revalidate" {
		t.Fatalf("cache = %q", res.Header.Get("Cache-Control"))
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/cards?limit=1000", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("If-None-Match", etag)
	again, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Body.Close()
	body, err := io.ReadAll(again.Body)
	if err != nil {
		t.Fatal(err)
	}
	if again.StatusCode != http.StatusNotModified {
		t.Fatalf("revalidate %d: %s", again.StatusCode, body)
	}
	if len(body) != 0 {
		t.Fatalf("revalidate body = %q", body)
	}
	if again.Header.Get("ETag") != etag {
		t.Fatalf("304 etag = %q", again.Header.Get("ETag"))
	}

	ignored, raw := do(t, http.MethodGet, "/api/v1/cards?deck_id=999999&limit=1000", nil)
	if ignored.StatusCode != http.StatusOK {
		t.Fatalf("deck_id %d: %s", ignored.StatusCode, raw)
	}
	if ignored.Header.Get("ETag") != etag {
		t.Fatal("deck_id changed the default deck response")
	}
}

func TestGetCard(t *testing.T) {
	var id int64
	err := pool.QueryRow(context.Background(), `
		INSERT INTO cards (
			deck_id, word, translation, ipa, pronunciation, stress_note,
			pos, grammar, usage, example, example_highlight, example_translation
		)
		SELECT id, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
		FROM decks WHERE slug = 'default'
		RETURNING id
	`,
		"persist",
		"упорствовать, продолжать (несмотря на трудности)",
		"/pərˈsɪst/",
		"[пэрси́ст]",
		"ударение на 2-м слоге",
		"verb",
		"Правильный глагол: persist — persisted — persisted.",
		"Нейтральный, чуть формальный.",
		"If you persist with daily practice, the words will stick.",
		"persist",
		"Если будешь упорно заниматься каждый день, слова закрепятся.",
	).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Reload(context.Background(), catalog_postgres_repository.New(pool), MarshalCardList); err != nil {
		t.Fatal(err)
	}

	res, raw := do(t, http.MethodGet, fmt.Sprintf("/api/v1/cards/%d", id), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get %d: %s", res.StatusCode, raw)
	}
	var card map[string]any
	if err := json.Unmarshal(raw, &card); err != nil {
		t.Fatal(err)
	}
	if card["word"] != "persist" || card["pos"] != "verb" || card["posRu"] != "глагол" {
		t.Fatalf("card = %s", raw)
	}
	if card["pronunciation"] == "" || card["stressNote"] == "" || card["grammar"] == "" || card["usage"] == "" || card["exampleTranslation"] == "" {
		t.Fatalf("card = %s", raw)
	}
	for _, key := range []string{"rusTrans", "extraLabel", "extra", "style"} {
		if _, ok := card[key]; ok {
			t.Fatalf("%s still present: %s", key, raw)
		}
	}
}

func TestGetMissingCard(t *testing.T) {
	res, raw := do(t, http.MethodGet, "/api/v1/cards/999999", nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("get %d: %s", res.StatusCode, raw)
	}
	var env errEnv
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "not_found" || env.RequestID == "" {
		t.Fatalf("envelope = %+v", env)
	}
}

func TestWriteRoutesAreGone(t *testing.T) {
	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/admin/cards"},
		{http.MethodPatch, "/api/v1/admin/cards/1"},
		{http.MethodDelete, "/api/v1/admin/cards/1"},
	} {
		res, raw := do(t, tc.method, tc.path, map[string]string{"word": "nope"})
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("%s %s = %d: %s", tc.method, tc.path, res.StatusCode, raw)
		}
	}
}

func TestSnapshotMatchesDatabase(t *testing.T) {
	ctx := context.Background()
	repo := catalog_postgres_repository.New(pool)
	if _, err := pool.Exec(ctx, `DELETE FROM cards WHERE deck_id = (SELECT id FROM decks WHERE slug = 'default')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO cards (deck_id, word, translation, pos, example, example_highlight)
		SELECT id, 'alpha', 'альфа', 'noun', 'Alpha.', 'Alpha' FROM decks WHERE slug = 'default'
	`); err != nil {
		t.Fatal(err)
	}
	if err := store.Reload(ctx, repo, MarshalCardList); err != nil {
		t.Fatal(err)
	}

	res, raw := do(t, http.MethodGet, "/api/v1/cards?limit=1000&offset=0", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list %d: %s", res.StatusCode, raw)
	}
	if res.Header.Get("Vary") != "Accept-Encoding" {
		t.Fatalf("vary = %q", res.Header.Get("Vary"))
	}
	deck, err := repo.GetAdminDeck(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cards, err := repo.ListAllCards(ctx, deck.ID)
	if err != nil {
		t.Fatal(err)
	}
	want, err := MarshalCardList(cards, len(cards), 1000, 0)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(want) {
		t.Fatalf("snapshot != database\n%s\n%s", raw, want)
	}
	etag := res.Header.Get("ETag")
	if etag == "" || !strings.HasPrefix(etag, `W/"`) {
		t.Fatalf("etag = %q", etag)
	}
}

func TestListCardsClientClosed(t *testing.T) {
	core, logs := observer.New(zapcore.DebugLevel)
	log := &core_logger.Logger{Logger: zap.New(core)}
	h := New(catalog_snapshot.New())

	for _, tc := range []struct {
		name   string
		cancel func(context.Context) (context.Context, context.CancelFunc)
		status int
	}{
		{name: "canceled", cancel: func(ctx context.Context) (context.Context, context.CancelFunc) {
			ctx, cancel := context.WithCancel(ctx)
			cancel()
			return ctx, cancel
		}, status: 499},
		{name: "timeout", cancel: func(ctx context.Context) (context.Context, context.CancelFunc) {
			return context.WithDeadline(ctx, time.Now().Add(-time.Second))
		}, status: http.StatusGatewayTimeout},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := tc.cancel(context.Background())
			defer cancel()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/cards?limit=1000", nil).WithContext(core_logger.ToContext(ctx, log))
			req.Header.Set("X-Request-ID", "closed")
			rec := httptest.NewRecorder()
			h.ListCards(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status = %d body %s", rec.Code, rec.Body.String())
			}
			if tc.status == 499 && rec.Body.Len() != 0 {
				t.Fatalf("body = %s", rec.Body.String())
			}
		})
	}
	for _, entry := range logs.All() {
		if entry.Level >= zapcore.ErrorLevel {
			t.Fatalf("error log: %s", entry.Message)
		}
	}
}

func TestLimit(t *testing.T) {
	for _, query := range []string{"limit=0", "limit=-1", "limit=1001"} {
		lim, raw := do(t, http.MethodGet, "/api/v1/cards?"+query, nil)
		if lim.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s status %d: %s", query, lim.StatusCode, raw)
		}
		var env errEnv
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatal(err)
		}
		_, value, _ := strings.Cut(query, "=")
		if env.Error.Code != "invalid_argument" || env.Error.Message != "limit "+value+" must be from 1 to 1000" {
			t.Fatalf("%s envelope = %+v", query, env.Error)
		}
	}
}
