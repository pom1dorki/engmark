package core_http_response

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResponseWriterRecordsOneHeader(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := NewResponseWriter(rec)
	rw.WriteHeader(http.StatusCreated)
	rw.WriteHeader(http.StatusTeapot)
	if rw.GetStatusCode() != http.StatusCreated || rec.Code != http.StatusCreated {
		t.Fatalf("status = %d recorder %d", rw.GetStatusCode(), rec.Code)
	}
	if !rw.WroteHeader() {
		t.Fatal("header not recorded")
	}
	n, err := rw.Write([]byte("abc"))
	if err != nil || n != 3 || rw.Written() != 3 {
		t.Fatalf("write n=%d written=%d err=%v", n, rw.Written(), err)
	}

	implicit := NewResponseWriter(httptest.NewRecorder())
	if _, err := implicit.Write([]byte("ok")); err != nil {
		t.Fatal(err)
	}
	if implicit.GetStatusCode() != http.StatusOK || !implicit.WroteHeader() {
		t.Fatalf("implicit status = %d wrote %v", implicit.GetStatusCode(), implicit.WroteHeader())
	}
	if implicit.Unwrap() == nil {
		t.Fatal("nil unwrap")
	}

	flushed := httptest.NewRecorder()
	controller := http.NewResponseController(NewResponseWriter(flushed))
	if err := controller.Flush(); err != nil {
		t.Fatal(err)
	}
	if !flushed.Flushed {
		t.Fatal("flush did not reach the recorder")
	}
}
