package core_http_response

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"go.uber.org/zap"
)

const catalogCacheControl = "public, max-age=0, must-revalidate"

func (h *HTTPResponseHandler) CachedJSON(r *http.Request, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		h.ErrorResponse(err, "encode response")
		return
	}

	h.CachedBytes(r, payload, WeakETag(payload))
}

func (h *HTTPResponseHandler) CachedBytes(r *http.Request, payload []byte, etag string) {
	if etag == "" {
		etag = WeakETag(payload)
	}
	header := h.rw.Header()
	setJSONHeaders(header)
	header.Set("ETag", etag)
	header.Set("Cache-Control", catalogCacheControl)
	if ifNoneMatch(r.Header.Get("If-None-Match"), etag) {
		h.rw.WriteHeader(http.StatusNotModified)
		return
	}

	h.rw.WriteHeader(http.StatusOK)
	if _, err := h.rw.Write(payload); err != nil {
		h.log.Error("write HTTP response", zap.Error(err))
	}
}

func WeakETag(payload []byte) string {
	sum := sha256.Sum256(payload)
	return `W/"` + hex.EncodeToString(sum[:]) + `"`
}

func setJSONHeaders(header http.Header) {
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Vary", "Accept-Encoding")
}

func ifNoneMatch(header, etag string) bool {
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if header == "*" {
		return true
	}
	want := etagToken(etag)
	for _, part := range strings.Split(header, ",") {
		if etagToken(part) == want {
			return true
		}
	}
	return false
}

func etagToken(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "W/")
	value = strings.TrimPrefix(value, "w/")
	return strings.Trim(value, `"`)
}
