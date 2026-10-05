package core_http_response

import "net/http"

type ResponseWriter struct {
	http.ResponseWriter
	statusCode  int
	wroteHeader bool
	bytes       int
}

func NewResponseWriter(w http.ResponseWriter) *ResponseWriter {
	return &ResponseWriter{ResponseWriter: w}
}

func (rw *ResponseWriter) WriteHeader(code int) {
	if rw.wroteHeader {
		return
	}
	rw.wroteHeader = true
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *ResponseWriter) Write(b []byte) (int, error) {
	if !rw.wroteHeader {
		rw.WriteHeader(http.StatusOK)
	}
	n, err := rw.ResponseWriter.Write(b)
	rw.bytes += n
	return n, err
}

func (rw *ResponseWriter) Unwrap() http.ResponseWriter { return rw.ResponseWriter }

func (rw *ResponseWriter) WroteHeader() bool { return rw.wroteHeader }

func (rw *ResponseWriter) Written() int { return rw.bytes }

func (rw *ResponseWriter) GetStatusCode() int {
	if !rw.wroteHeader {
		return http.StatusOK
	}
	return rw.statusCode
}
