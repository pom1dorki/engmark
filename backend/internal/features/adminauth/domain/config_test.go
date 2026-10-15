package adminauth_domain

import (
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func testHash(t *testing.T) string {
	t.Helper()
	raw, err := bcrypt.GenerateFromPassword([]byte("secret-pass"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestDecodeHash(t *testing.T) {
	raw := testHash(t)
	for name, value := range map[string]string{"raw": raw, "base64": EncodeHash(raw), "padded": "  " + EncodeHash(raw) + "\n"} {
		got, err := DecodeHash(value)
		if err != nil || got != raw {
			t.Fatalf("%s: got %q, %v", name, got, err)
		}
	}
	if strings.Contains(EncodeHash(raw), "$") {
		t.Fatal("encoded hash must not contain $")
	}
	for _, bad := range []string{"password", "$2a$10$tooshort", "!!!not base64!!!", EncodeHash("plain text")} {
		if _, err := DecodeHash(bad); err == nil {
			t.Fatalf("%q must be rejected", bad)
		}
	}
}

func TestNewConfig(t *testing.T) {
	t.Setenv("ADMIN_PASSWORD_HASH", "")
	t.Setenv("ADMIN_SESSION_TTL", "")
	t.Setenv("ADMIN_COOKIE_SECURE", "")
	t.Setenv("ADMIN_ALLOWED_ORIGINS", "")
	cfg, err := NewConfig()
	if err != nil || cfg.Enabled() || cfg.SessionTTL != 12*time.Hour || !cfg.CookieSecure {
		t.Fatalf("defaults = %+v, %v", cfg, err)
	}

	raw := testHash(t)
	t.Setenv("ADMIN_PASSWORD_HASH", EncodeHash(raw))
	t.Setenv("ADMIN_SESSION_TTL", "30m")
	t.Setenv("ADMIN_COOKIE_SECURE", "false")
	t.Setenv("ADMIN_ALLOWED_ORIGINS", "http://localhost:5173,https://example.com")
	t.Setenv("ADMIN_TRUSTED_PROXIES", "10.0.0.0/8")
	cfg, err = NewConfig()
	if err != nil || !cfg.Enabled() || cfg.PasswordHash != raw || cfg.SessionTTL != 30*time.Minute || cfg.CookieSecure ||
		len(cfg.AllowedOrigins) != 2 || len(cfg.TrustedProxies) != 1 {
		t.Fatalf("config = %+v, %v", cfg, err)
	}

	t.Setenv("ADMIN_PASSWORD_HASH", "plain-password")
	if _, err := NewConfig(); err == nil || strings.Contains(err.Error(), "plain-password") {
		t.Fatalf("bad hash must fail without echoing it: %v", err)
	}
}
