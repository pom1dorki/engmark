package main

import (
	"bytes"
	"os"
	"strings"
	"testing"

	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
	"golang.org/x/crypto/bcrypt"
)

func stdinWith(t *testing.T, text string) *os.File {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.WriteString(text); err != nil {
		t.Fatal(err)
	}
	w.Close()
	t.Cleanup(func() { r.Close() })
	return r
}

func TestHashPassword(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := runHashPassword(nil, stdinWith(t, "long enough password\n"), &out, &errOut); code != 0 {
		t.Fatalf("code = %d, stderr = %q", code, errOut.String())
	}
	encoded := strings.TrimSpace(out.String())
	if strings.Contains(encoded, "$") {
		t.Fatalf("default output must be safe for .env: %q", encoded)
	}
	hash, err := adminauth_domain.DecodeHash(encoded)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte("long enough password")) != nil {
		t.Fatalf("hash does not match: %v", err)
	}

	out.Reset()
	if code := runHashPassword([]string{"--raw"}, stdinWith(t, "long enough password\r\n"), &out, &errOut); code != 0 || !strings.HasPrefix(out.String(), "$2") {
		t.Fatalf("raw: %d %q", code, out.String())
	}
}

func TestHashPasswordRejectsBadInput(t *testing.T) {
	for name, tc := range map[string]struct {
		args  []string
		input string
		code  int
	}{
		"too short":    {nil, "short\n", 1},
		"empty":        {nil, "", 1},
		"too long":     {nil, strings.Repeat("a", 80) + "\n", 1},
		"unknown flag": {[]string{"--wat"}, "long enough password\n", 2},
	} {
		var out, errOut bytes.Buffer
		if code := runHashPassword(tc.args, stdinWith(t, tc.input), &out, &errOut); code != tc.code || out.Len() != 0 {
			t.Errorf("%s: code = %d (want %d), stdout = %q", name, code, tc.code, out.String())
		}
	}
}
