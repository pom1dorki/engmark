package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	core_http_server "github.com/pom1dorki/engmark/internal/core/transport/http/server"
)

func TestSwaggerRoutes(t *testing.T) {
	t.Parallel()

	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := core_http_server.NewHTTPServer(core_http_server.Config{Addr: "127.0.0.1:0"}, log)
	httpServer.RegisterRoutes(swaggerRoute())
	srv := httptest.NewServer(httpServer.Handler())
	t.Cleanup(srv.Close)

	ui, err := http.Get(srv.URL + "/swagger/index.html")
	if err != nil {
		t.Fatal(err)
	}
	defer ui.Body.Close()
	if ui.StatusCode != http.StatusOK {
		t.Fatalf("index.html status = %d", ui.StatusCode)
	}
	body, err := io.ReadAll(ui.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "Swagger UI") {
		t.Fatal("index.html does not contain Swagger UI")
	}

	spec, err := http.Get(srv.URL + "/swagger/doc.json")
	if err != nil {
		t.Fatal(err)
	}
	defer spec.Body.Close()
	if spec.StatusCode != http.StatusOK {
		t.Fatalf("doc.json status = %d", spec.StatusCode)
	}
	var doc map[string]any
	if err := json.NewDecoder(spec.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	if doc["swagger"] != "2.0" {
		t.Fatalf("swagger version = %v", doc["swagger"])
	}
	defs, _ := doc["definitions"].(map[string]any)
	patch, _ := defs["catalog_transport_http.PatchCardRequest"].(map[string]any)
	props, _ := patch["properties"].(map[string]any)
	word, _ := props["word"].(map[string]any)
	if word["type"] != "string" {
		t.Fatalf("PatchCardRequest.word = %#v, want string", word)
	}
	if _, ok := defs["catalog_transport_http.setString"]; ok {
		t.Fatal("setString leaked into swagger definitions")
	}
}
