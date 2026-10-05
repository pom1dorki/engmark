package postgres

import (
	"errors"
	"strings"
	"testing"
)

func TestURLFromEnvRequiresValue(t *testing.T) {
	t.Setenv("DATABASE_URL", " ")
	if _, err := URLFromEnv(); err == nil {
		t.Fatal("expected error")
	}
}

func TestURLFromEnvRejectsSSLMode(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://engmark:s3cret@localhost:5432/engmark?sslmode=skip")
	_, err := URLFromEnv()
	if err == nil || strings.Contains(err.Error(), "s3cret") || !strings.Contains(err.Error(), "sslmode") {
		t.Fatalf("err = %v", err)
	}
}

func TestMigrateRejectsBlank(t *testing.T) {
	t.Parallel()
	if err := Migrate(" "); err == nil {
		t.Fatal("expected error")
	}
}

func TestMigrateRedactsPassword(t *testing.T) {
	t.Parallel()
	err := Migrate("postgres://engmark:s3cret@127.0.0.1:1/engmark?sslmode=disable")
	if err == nil {
		t.Fatal("expected error")
	}
	if strings.Contains(err.Error(), "s3cret") {
		t.Fatal(err)
	}
}

func TestRedact(t *testing.T) {
	t.Parallel()
	raw := "postgres://engmark:s3cret@db:5432/engmark?sslmode=require"
	err := redact(errors.New("auth failed for "+raw), raw)
	if strings.Contains(err.Error(), "s3cret") || strings.Contains(err.Error(), "db:5432") {
		t.Fatal(err)
	}
}
