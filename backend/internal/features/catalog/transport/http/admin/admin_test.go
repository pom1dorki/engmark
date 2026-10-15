package catalog_admin_transport_http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
	adminauth_postgres_repository "github.com/pom1dorki/engmark/internal/features/adminauth/repository/postgres"
	adminauth_service "github.com/pom1dorki/engmark/internal/features/adminauth/service"
	adminauth_transport_http "github.com/pom1dorki/engmark/internal/features/adminauth/transport/http"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
	"github.com/pom1dorki/engmark/internal/testkit"
	"golang.org/x/crypto/bcrypt"
)

const password = "correct horse battery"

var (
	pool *pgxpool.Pool
	srv  *httptest.Server
	hash string
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	var cleanup func()
	var err error
	pool, cleanup, err = testkit.Start(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "postgres: %v\n", err)
		os.Exit(1)
	}
	raw, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bcrypt: %v\n", err)
		os.Exit(1)
	}
	hash = string(raw)

	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		fmt.Fprintf(os.Stderr, "logger: %v\n", err)
		os.Exit(1)
	}
	cfg := adminauth_domain.Config{PasswordHash: hash, SessionTTL: time.Hour}
	auth := adminauth_service.New(adminauth_postgres_repository.New(pool), cfg,
		adminauth_service.WithMinLoginLatency(0), adminauth_service.WithLoginLimits(1000, 1000))
	guard, err := adminauth_transport_http.NewGuard(auth, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "guard: %v\n", err)
		os.Exit(1)
	}
	svc := catalog_service.New(catalog_postgres_repository.New(pool))

	httpServer := core_http_server.NewHTTPServer(core_http_server.Config{Addr: "127.0.0.1:0"}, log,
		core_http_middleware.RequestID(), core_http_middleware.Logger(log), core_http_middleware.Trace(), core_http_middleware.Panic())
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(adminauth_transport_http.New(auth, guard).Routes()...)
	v1.RegisterRoutes(core_http_server.WithMiddleware(New(svc).Routes(), guard.NoStore(), guard.RequireAdmin())...)
	httpServer.RegisterAPIRouters(v1)
	srv = httptest.NewServer(httpServer.Handler())

	code := m.Run()
	srv.Close()
	cleanup()
	os.Exit(code)
}

type client struct {
	t *testing.T
	c *http.Client
}

type reply struct {
	status int
	header http.Header
	body   map[string]any
	raw    []byte
}

func newClient(t *testing.T) *client {
	t.Helper()
	for _, q := range []string{
		`DELETE FROM admin_sessions`, `DELETE FROM card_versions`, `DELETE FROM cards`, `DELETE FROM deck_revisions`,
		`UPDATE decks SET revision = 0`,
	} {
		if _, err := pool.Exec(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &client{t: t, c: &http.Client{Jar: jar}}
}

func (c *client) call(method, path string, headers map[string]string, body any) reply {
	c.t.Helper()
	var rdr io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rdr = bytes.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			c.t.Fatal(err)
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+"/api/v1/admin"+path, rdr)
	if err != nil {
		c.t.Fatal(err)
	}
	if method != http.MethodGet {
		req.Header.Set("Origin", srv.URL)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.c.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := reply{status: resp.StatusCode, header: resp.Header, raw: raw}
	_ = json.Unmarshal(raw, &out.body)
	return out
}

func (c *client) login() {
	c.t.Helper()
	if r := c.call(http.MethodPost, "/session", nil, map[string]string{"password": password}); r.status != http.StatusOK {
		c.t.Fatalf("login: %d %s", r.status, r.raw)
	}
}

func card(word string) map[string]any {
	return map[string]any{"word": word, "pos": "noun", "translation": "перевод " + word}
}

func (r reply) errCode() string {
	if e, ok := r.body["error"].(map[string]any); ok {
		s, _ := e["code"].(string)
		return s
	}
	return ""
}

func (r reply) details() map[string]any {
	if e, ok := r.body["error"].(map[string]any); ok {
		d, _ := e["details"].(map[string]any)
		return d
	}
	return nil
}

func ifMatch(rev int) map[string]string {
	return map[string]string{"If-Match": fmt.Sprintf(`"r%d"`, rev)}
}

func TestFullCycle(t *testing.T) {
	c := newClient(t)

	if r := c.call(http.MethodGet, "/deck", nil, nil); r.status != http.StatusUnauthorized {
		t.Fatalf("no cookie: %d", r.status)
	}
	c.login()

	r := c.call(http.MethodGet, "/deck", nil, nil)
	if r.status != http.StatusOK || r.header.Get("ETag") != `"r0"` || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("deck: %d %v", r.status, r.header)
	}
	if r2 := c.call(http.MethodGet, "/deck", map[string]string{"If-None-Match": `"r0"`}, nil); r2.status != http.StatusNotModified {
		t.Fatalf("If-None-Match: %d", r2.status)
	}

	if r := c.call(http.MethodPost, "/changesets", nil, map[string]any{"baseRevision": 0, "create": []any{card("alpha")}}); r.status != http.StatusPreconditionRequired || r.errCode() != "precondition_required" {
		t.Fatalf("no If-Match: %d %s", r.status, r.raw)
	}

	r = c.call(http.MethodPost, "/changesets", ifMatch(0), map[string]any{"baseRevision": 0, "message": "первая", "create": []any{card("alpha"), card("beta")}})
	if r.status != http.StatusCreated || r.header.Get("ETag") != `"r1"` {
		t.Fatalf("first changeset: %d %s", r.status, r.raw)
	}
	created := r.body["created"].([]any)
	if r.body["revision"].(float64) != 1 || len(created) != 2 {
		t.Fatalf("result = %s", r.raw)
	}
	alphaID := int(created[0].(map[string]any)["id"].(float64))

	r = c.call(http.MethodPost, "/changesets", ifMatch(0), map[string]any{"baseRevision": 0, "create": []any{card("gamma")}})
	if r.status != http.StatusPreconditionFailed || r.errCode() != "revision_mismatch" {
		t.Fatalf("stale revision: %d %s", r.status, r.raw)
	}
	if d := r.details(); d["baseRevision"].(float64) != 0 || d["currentRevision"].(float64) != 1 {
		t.Fatalf("details = %v", d)
	}

	r = c.call(http.MethodGet, "/changes?since=0", nil, nil)
	if r.status != http.StatusOK || r.body["revision"].(float64) != 1 || len(r.body["items"].([]any)) != 2 {
		t.Fatalf("changes: %d %s", r.status, r.raw)
	}

	edited := card("alpha")
	edited["usage"] = "правка"
	r = c.call(http.MethodPost, "/changesets", ifMatch(1), map[string]any{
		"baseRevision": 1,
		"update":       []any{map[string]any{"id": alphaID, "baseVersion": 1, "card": edited}},
	})
	if r.status != http.StatusCreated || r.header.Get("ETag") != `"r2"` {
		t.Fatalf("update: %d %s", r.status, r.raw)
	}

	r = c.call(http.MethodGet, fmt.Sprintf("/cards/%d", alphaID), nil, nil)
	if r.status != http.StatusOK || r.header.Get("ETag") != `"v2"` || r.body["usage"] != "правка" {
		t.Fatalf("card: %d %s", r.status, r.raw)
	}
	r = c.call(http.MethodGet, fmt.Sprintf("/cards/%d/versions", alphaID), nil, nil)
	if items := r.body["items"].([]any); r.status != http.StatusOK || len(items) != 2 {
		t.Fatalf("versions: %d %s", r.status, r.raw)
	}

	r = c.call(http.MethodPost, "/changesets", ifMatch(2), map[string]any{
		"baseRevision": 2,
		"update":       []any{map[string]any{"id": alphaID, "baseVersion": 2, "card": edited}},
	})
	if r.status != http.StatusBadRequest || r.errCode() != "no_changes" {
		t.Fatalf("no_changes: %d %s", r.status, r.raw)
	}

	r = c.call(http.MethodPost, "/changesets", ifMatch(2), map[string]any{
		"baseRevision": 2,
		"archive":      []any{map[string]any{"id": alphaID, "baseVersion": 1}},
	})
	if r.status != http.StatusConflict || r.errCode() != "version_mismatch" {
		t.Fatalf("version_mismatch: %d %s", r.status, r.raw)
	}
	if d := r.details(); d["expected"].(float64) != 1 || d["actual"].(float64) != 2 {
		t.Fatalf("details = %v", d)
	}

	r = c.call(http.MethodPost, "/changesets", ifMatch(2), map[string]any{"baseRevision": 2, "create": []any{card("beta")}})
	if r.status != http.StatusConflict || r.errCode() != "duplicate_card" {
		t.Fatalf("duplicate_card: %d %s", r.status, r.raw)
	}

	if r := c.call(http.MethodGet, "/deck", nil, nil); r.header.Get("ETag") != `"r2"` {
		t.Fatalf("deck after failures: %s", r.raw)
	}

	r = c.call(http.MethodPost, "/revisions/1/revert-draft", nil, nil)
	if r.status != http.StatusOK || r.body["baseRevision"].(float64) != 2 || len(r.body["update"].([]any)) != 1 {
		t.Fatalf("revert-draft: %d %s", r.status, r.raw)
	}
	if r := c.call(http.MethodGet, "/deck", nil, nil); r.header.Get("ETag") != `"r2"` {
		t.Fatal("revert-draft must not write")
	}

	r = c.call(http.MethodGet, "/revisions", nil, nil)
	if items := r.body["items"].([]any); r.status != http.StatusOK || len(items) != 2 || items[0].(map[string]any)["revision"].(float64) != 2 {
		t.Fatalf("revisions: %d %s", r.status, r.raw)
	}
	r = c.call(http.MethodGet, "/revisions/2", nil, nil)
	if ch := r.body["changes"].([]any); r.status != http.StatusOK || len(ch) != 1 || ch[0].(map[string]any)["kind"] != "updated" {
		t.Fatalf("revision 2: %d %s", r.status, r.raw)
	}
	r = c.call(http.MethodGet, "/revisions/1/export", nil, nil)
	var exported []map[string]any
	if err := json.Unmarshal(r.raw, &exported); err != nil || len(exported) != 2 || exported[0]["usage"] != "" || r.header.Get("ETag") != `"r1"` {
		t.Fatalf("export r1: %d %v %s", r.status, err, r.raw)
	}
	if !strings.Contains(r.header.Get("Content-Disposition"), "engmark-r1.json") {
		t.Fatalf("Content-Disposition = %q", r.header.Get("Content-Disposition"))
	}
	r = c.call(http.MethodGet, "/export", nil, nil)
	var current []map[string]any
	if err := json.Unmarshal(r.raw, &current); err != nil || len(current) != 2 || current[0]["usage"] != "правка" {
		t.Fatalf("export current: %d %v", r.status, err)
	}

	r = c.call(http.MethodGet, "/cards?q=alp&limit=10", nil, nil)
	if r.status != http.StatusOK || r.body["total"].(float64) != 1 || r.header.Get("ETag") != `"r2"` {
		t.Fatalf("cards: %d %s", r.status, r.raw)
	}
}

func TestChangesetValidationErrors(t *testing.T) {
	c := newClient(t)
	c.login()

	r := c.call(http.MethodPost, "/changesets", ifMatch(0), map[string]any{"baseRevision": 0})
	if r.status != http.StatusBadRequest || r.errCode() != "empty_changeset" {
		t.Fatalf("empty: %d %s", r.status, r.raw)
	}

	bad := map[string]any{"word": "слово", "pos": "thing", "translation": ""}
	r = c.call(http.MethodPost, "/changesets", ifMatch(0), map[string]any{"baseRevision": 0, "create": []any{bad}})
	errs, _ := r.details()["errors"].([]any)
	if r.status != http.StatusBadRequest || r.errCode() != "invalid_argument" || len(errs) != 3 {
		t.Fatalf("invalid cards: %d %s", r.status, r.raw)
	}
	first := errs[0].(map[string]any)
	if first["section"] != "create" || first["field"] == nil || first["code"] == nil {
		t.Fatalf("error item = %v", first)
	}

	r = c.call(http.MethodPost, "/changesets", ifMatch(5), map[string]any{"baseRevision": 0, "create": []any{card("alpha")}})
	if r.status != http.StatusBadRequest {
		t.Fatalf("If-Match vs baseRevision: %d %s", r.status, r.raw)
	}
	r = c.call(http.MethodPost, "/changesets", map[string]string{"If-Match": "42"}, map[string]any{"baseRevision": 42})
	if r.status != http.StatusBadRequest {
		t.Fatalf("bad If-Match format: %d", r.status)
	}
	r = c.call(http.MethodPost, "/changesets", ifMatch(0), []byte(`{"baseRevision":0,"create":[],"extra":1}`))
	if r.status != http.StatusBadRequest {
		t.Fatalf("unknown field: %d %s", r.status, r.raw)
	}
}

func (c *client) inProcess(method, path string, body []byte) reply {
	c.t.Helper()
	req := httptest.NewRequest(method, "/api/v1/admin"+path, bytes.NewReader(body))
	req.Header.Set("Origin", "http://"+req.Host)
	req.Header.Set("If-Match", `"r0"`)
	u, _ := url.Parse(srv.URL + "/api/v1/admin/changesets")
	for _, ck := range c.c.Jar.Cookies(u) {
		req.AddCookie(ck)
	}
	rec := httptest.NewRecorder()
	srv.Config.Handler.ServeHTTP(rec, req)
	out := reply{status: rec.Code, header: rec.Header(), raw: rec.Body.Bytes()}
	_ = json.Unmarshal(out.raw, &out.body)
	return out
}

func TestBodyLimits(t *testing.T) {
	c := newClient(t)
	c.login()

	if r := c.inProcess(http.MethodPost, "/changesets", bytes.Repeat([]byte("a"), 5<<20)); r.status != http.StatusRequestEntityTooLarge || r.errCode() != "payload_too_large" {
		t.Fatalf("5 MB changeset: %d %s", r.status, r.raw)
	}
	if r := c.inProcess(http.MethodPost, "/revisions/1/revert-draft", bytes.Repeat([]byte("a"), 64<<10)); r.status != http.StatusRequestEntityTooLarge {
		t.Fatalf("64 KB revert-draft: %d", r.status)
	}
	anon := &client{t: t, c: &http.Client{}}
	anon.c.Jar, _ = cookiejar.New(nil)
	if r := anon.inProcess(http.MethodPost, "/changesets", bytes.Repeat([]byte("a"), 5<<20)); r.status != http.StatusUnauthorized {
		t.Fatalf("anonymous 5 MB: %d", r.status)
	}

	cards := make([]any, 0, 1000)
	for i := range 1000 {
		cards = append(cards, map[string]any{"word": "w" + strings.Repeat("a", i%20+1), "pos": "noun", "translation": strings.Repeat("я", 300)})
	}
	r := c.call(http.MethodPost, "/changesets/validate", nil, map[string]any{"imports": []any{map[string]any{"fileName": "big.json", "cards": cards}}})
	if r.status != http.StatusOK {
		t.Fatalf("a 600 KB changeset: %d %.200s", r.status, r.raw)
	}
}

func TestValidateReportsImportCounts(t *testing.T) {
	c := newClient(t)
	c.login()
	if r := c.call(http.MethodPost, "/changesets", ifMatch(0), map[string]any{"baseRevision": 0, "create": []any{card("alpha")}}); r.status != http.StatusCreated {
		t.Fatalf("seed: %d %s", r.status, r.raw)
	}
	r := c.call(http.MethodPost, "/changesets/validate", nil, map[string]any{
		"imports": []any{map[string]any{"fileName": "travel.json", "cards": []any{card("alpha"), card("delta"), card("echo")}}},
	})
	imports, _ := r.body["imports"].([]any)
	if r.status != http.StatusOK || len(imports) != 1 {
		t.Fatalf("validate: %d %s", r.status, r.raw)
	}
	file := imports[0].(map[string]any)
	if file["added"].(float64) != 2 || len(file["skipped"].([]any)) != 1 || r.body["revision"].(float64) != 1 {
		t.Fatalf("report = %s", r.raw)
	}
	if r := c.call(http.MethodGet, "/deck", nil, nil); r.header.Get("ETag") != `"r1"` {
		t.Fatalf("validate wrote something: %s", r.raw)
	}
}

func TestConcurrentChangesetsOverHTTP(t *testing.T) {
	a, b := newClient(t), newClient(t)
	a.login()
	b.login()

	results := make(chan int, 2)
	for i, c := range []*client{a, b} {
		go func() {
			r := c.call(http.MethodPost, "/changesets", ifMatch(0), map[string]any{"baseRevision": 0, "create": []any{card(fmt.Sprintf("word%c", 'a'+i))}})
			results <- r.status
		}()
	}
	got := []int{<-results, <-results}
	created, stale := 0, 0
	for _, s := range got {
		switch s {
		case http.StatusCreated:
			created++
		case http.StatusPreconditionFailed:
			stale++
		}
	}
	if created != 1 || stale != 1 {
		t.Fatalf("statuses = %v, want one 201 and one 412", got)
	}
}
