package core_http_server

import (
	"testing"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
)

func TestReadHeaderTimeout(t *testing.T) {
	log, err := core_logger.NewLogger(core_logger.Config{Level: "error"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewHTTPServer(Config{Addr: "127.0.0.1:0"}, log).httpServer()
	if server.ReadHeaderTimeout != readHeaderTimeout || server.ReadTimeout != readTimeout || server.WriteTimeout != writeTimeout || server.IdleTimeout != idleTimeout {
		t.Fatalf("timeouts header=%s read=%s write=%s idle=%s", server.ReadHeaderTimeout, server.ReadTimeout, server.WriteTimeout, server.IdleTimeout)
	}
	if server.MaxHeaderBytes != maxHeaderBytes {
		t.Fatalf("max header bytes = %d", server.MaxHeaderBytes)
	}
	if server.Addr != "127.0.0.1:0" {
		t.Fatalf("addr = %s", server.Addr)
	}
	if server.Handler == nil {
		t.Fatal("nil handler")
	}
}
