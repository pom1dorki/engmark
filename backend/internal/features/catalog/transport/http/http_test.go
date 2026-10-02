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
	"strings"
	"testing"
	"time"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_middleware "github.com/pom1dorki/engmark/internal/core/transport/http/middleware"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
	"github.com/pom1dorki/engmark/internal/testkit"
)

const adminToken = "test-admin-token"

var srv *httptest.Server

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanupDB, err := testkit.Start(ctx)
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
		core_http_server.Config{Addr: "127.0.0.1:0", AllowedOrigins: []string{"http://localhost"}},
		log,
		core_http_middleware.CORS([]string{"http://localhost"}),
		core_http_middleware.RequestID(),
		core_http_middleware.Logger(log),
		core_http_middleware.Trace(),
		core_http_middleware.Panic(),
		core_http_middleware.LimitBody(32<<10),
	)
	h := New(catalog_service.New(catalog_postgres_repository.New(pool)), adminToken)
	v1 := core_http_server.NewAPIVersionRouter(core_http_server.ApiVersion1)
	v1.RegisterRoutes(h.Routes()...)
	httpServer.RegisterAPIRouters(v1)

	srv = httptest.NewServer(httpServer.Handler())
	code := m.Run()
	srv.Close()
	cleanupDB()
	os.Exit(code)
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

func do(t *testing.T, method, path, token string, body any) (*http.Response, []byte) {
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
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
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
	res, raw := do(t, http.MethodGet, "/api/v1/cards?limit=100", "", nil)
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

func TestGetCard(t *testing.T) {
	body := map[string]string{
		"word":               "persist",
		"translation":        "упорствовать, продолжать (несмотря на трудности)",
		"ipa":                "/pərˈsɪst/",
		"pronunciation":      "[пэрси́ст]",
		"stressNote":         "ударение на 2-м слоге",
		"pos":                "verb",
		"grammar":            "Правильный глагол: persist — persisted — persisted.",
		"usage":              "Нейтральный, чуть формальный.",
		"example":            "If you persist with daily practice, the words will stick.",
		"exampleHighlight":   "persist",
		"exampleTranslation": "Если будешь упорно заниматься каждый день, слова закрепятся.",
	}
	createdRes, raw := do(t, http.MethodPost, "/api/v1/admin/cards", adminToken, body)
	if createdRes.StatusCode != http.StatusCreated {
		t.Fatalf("create %d: %s", createdRes.StatusCode, raw)
	}
	var created cardBody
	if err := json.Unmarshal(raw, &created); err != nil {
		t.Fatal(err)
	}

	res, raw := do(t, http.MethodGet, fmt.Sprintf("/api/v1/cards/%d", created.ID), "", nil)
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

func TestCreateUnauthorizedDoesNotInsert(t *testing.T) {
	before := mustList(t).Total
	res, raw := do(t, http.MethodPost, "/api/v1/admin/cards", "", map[string]string{
		"word": "nope", "translation": "нет", "pos": "noun",
	})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d: %s", res.StatusCode, raw)
	}
	var env errEnv
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "unauthenticated" || env.RequestID == "" {
		t.Fatalf("envelope = %+v", env)
	}
	if got := mustList(t).Total; got != before {
		t.Fatalf("total %d, want %d", got, before)
	}
}

func TestCreateThenConflict(t *testing.T) {
	word := fmt.Sprintf("word-%d", time.Now().UnixNano())
	body := map[string]string{
		"word": word, "translation": "перевод", "pos": "noun",
	}
	res, raw := do(t, http.MethodPost, "/api/v1/admin/cards", adminToken, body)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create %d: %s", res.StatusCode, raw)
	}
	var created cardBody
	if err := json.Unmarshal(raw, &created); err != nil {
		t.Fatal(err)
	}
	var createdFields map[string]any
	if err := json.Unmarshal(raw, &createdFields); err != nil {
		t.Fatal(err)
	}
	if createdFields["posRu"] != "существительное" {
		t.Fatalf("posRu = %v", createdFields["posRu"])
	}
	got, raw := do(t, http.MethodGet, fmt.Sprintf("/api/v1/cards/%d", created.ID), "", nil)
	if got.StatusCode != http.StatusOK {
		t.Fatalf("get created %d: %s", got.StatusCode, raw)
	}
	again, raw := do(t, http.MethodPost, "/api/v1/admin/cards", adminToken, body)
	if again.StatusCode != http.StatusConflict {
		t.Fatalf("dup %d: %s", again.StatusCode, raw)
	}
	var env errEnv
	if err := json.Unmarshal(raw, &env); err != nil || env.Error.Code != "conflict" {
		t.Fatalf("envelope %v %s", err, raw)
	}
}

func TestPatchVersion(t *testing.T) {
	word := fmt.Sprintf("patch-%d", time.Now().UnixNano())
	res, raw := do(t, http.MethodPost, "/api/v1/admin/cards", adminToken, map[string]string{
		"word": word, "translation": "старый", "pos": "verb",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create %d: %s", res.StatusCode, raw)
	}
	var created cardBody
	if err := json.Unmarshal(raw, &created); err != nil {
		t.Fatal(err)
	}

	missing, raw := do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/cards/%d", created.ID), adminToken, map[string]string{
		"translation": "нет версии",
	})
	if missing.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing version %d: %s", missing.StatusCode, raw)
	}

	stale, raw := do(t, http.MethodPatch, fmt.Sprintf("/api/v1/admin/cards/%d", created.ID), adminToken, map[string]any{
		"version": 0, "translation": "новый",
	})
	if stale.StatusCode != http.StatusConflict {
		t.Fatalf("stale %d: %s", stale.StatusCode, raw)
	}
	got, raw := do(t, http.MethodGet, fmt.Sprintf("/api/v1/cards/%d", created.ID), "", nil)
	var card cardBody
	if err := json.Unmarshal(raw, &card); err != nil {
		t.Fatal(err)
	}
	if got.StatusCode != http.StatusOK || card.Translation != "старый" {
		t.Fatalf("translation changed: %d %s", got.StatusCode, raw)
	}
}

func TestDeleteAndLimit(t *testing.T) {
	word := fmt.Sprintf("del-%d", time.Now().UnixNano())
	res, raw := do(t, http.MethodPost, "/api/v1/admin/cards", adminToken, map[string]string{
		"word": word, "translation": "удалить", "pos": "adv",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create %d: %s", res.StatusCode, raw)
	}
	var created cardBody
	if err := json.Unmarshal(raw, &created); err != nil {
		t.Fatal(err)
	}
	del, raw := do(t, http.MethodDelete, fmt.Sprintf("/api/v1/admin/cards/%d", created.ID), adminToken, nil)
	if del.StatusCode != http.StatusNoContent {
		t.Fatalf("delete %d: %s", del.StatusCode, raw)
	}
	got, raw := do(t, http.MethodGet, fmt.Sprintf("/api/v1/cards/%d", created.ID), "", nil)
	if got.StatusCode != http.StatusNotFound {
		t.Fatalf("get deleted %d: %s", got.StatusCode, raw)
	}
	for _, query := range []string{"limit=0", "limit=-1", "limit=101"} {
		lim, raw := do(t, http.MethodGet, "/api/v1/cards?"+query, "", nil)
		if lim.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s status %d: %s", query, lim.StatusCode, raw)
		}
		var env errEnv
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatal(err)
		}
		if env.Error.Code != "invalid_argument" || env.Error.Message != "limit "+queryValue(query)+" must be from 1 to 100" {
			t.Fatalf("%s envelope = %+v", query, env.Error)
		}
	}
}

func queryValue(query string) string {
	_, value, _ := strings.Cut(query, "=")
	return value
}

func TestCreateValidationMessage(t *testing.T) {
	res, raw := do(t, http.MethodPost, "/api/v1/admin/cards", adminToken, map[string]string{
		"word":             "persist",
		"translation":      "перевод",
		"pos":              "verb",
		"example":          "If you persist, the words stick.",
		"exampleHighlight": "missing",
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("create %d: %s", res.StatusCode, raw)
	}
	var env errEnv
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "invalid_argument" || env.Error.Message != "exampleHighlight is not in example" {
		t.Fatalf("envelope = %+v", env.Error)
	}
}
