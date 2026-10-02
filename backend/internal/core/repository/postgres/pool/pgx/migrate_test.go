package core_pgx_pool

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestConnectionURLSSLMode(t *testing.T) {
	t.Parallel()

	got, err := ConnectionURL(Config{
		Host:        "db.example.com",
		Port:        "5432",
		User:        "engmark",
		Password:    "s3cret",
		Database:    "engmark",
		SSLMode:     "verify-full",
		SSLRootCert: "/certs/ca.pem",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "sslmode=verify-full") || !strings.Contains(got, "sslrootcert=%2Fcerts%2Fca.pem") {
		t.Fatalf("url = %s", strings.ReplaceAll(got, "s3cret", "redacted"))
	}

	_, err = ConnectionURL(Config{SSLMode: "skip", Password: "s3cret"})
	if err == nil || strings.Contains(err.Error(), "s3cret") || !strings.Contains(err.Error(), "sslmode") {
		t.Fatalf("err = %v", err)
	}
}

func TestNewConfigRejectsSSLMode(t *testing.T) {
	t.Setenv("POSTGRES_HOST", "localhost")
	t.Setenv("POSTGRES_PORT", "5432")
	t.Setenv("POSTGRES_USER", "engmark")
	t.Setenv("POSTGRES_PASSWORD", "s3cret")
	t.Setenv("POSTGRES_DB", "engmark")
	t.Setenv("POSTGRES_TIMEOUT", "10s")
	t.Setenv("POSTGRES_SSLMODE", "skip")

	_, err := NewConfig()
	if err == nil || strings.Contains(err.Error(), "s3cret") || !strings.Contains(err.Error(), "sslmode") {
		t.Fatalf("err = %v", err)
	}
}

func TestMigrateUpRejectsBlank(t *testing.T) {
	t.Parallel()

	if err := MigrateUp("", ""); err == nil {
		t.Fatal("expected error")
	}
}

func TestMigrateUpMissingDirectory(t *testing.T) {
	t.Parallel()

	err := MigrateUp(
		"postgres://engmark:s3cret@127.0.0.1:1/engmark?sslmode=disable",
		filepath.Join(t.TempDir(), "missing"),
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), "s3cret") {
		t.Fatal("database url leaked")
	}
}

func TestRedactDatabaseURL(t *testing.T) {
	t.Parallel()

	raw := "postgres://engmark:s3cret@db:5432/engmark?sslmode=require"
	err := redactDatabaseURL(errors.New("auth failed for "+raw), raw)
	if strings.Contains(err.Error(), "s3cret") || strings.Contains(err.Error(), "db:5432") {
		t.Fatal(err)
	}
}
