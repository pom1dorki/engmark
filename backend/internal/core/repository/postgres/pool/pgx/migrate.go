package core_pgx_pool

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func MigrateUp(databaseURL, dir string) error {
	if strings.TrimSpace(databaseURL) == "" || strings.TrimSpace(dir) == "" {
		return fmt.Errorf("migrate: database url and directory are required")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	if _, err := os.Stat(abs); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}

	pgxURL := databaseURL
	switch {
	case strings.HasPrefix(pgxURL, "postgres://"):
		pgxURL = "pgx5://" + strings.TrimPrefix(pgxURL, "postgres://")
	case strings.HasPrefix(pgxURL, "postgresql://"):
		pgxURL = "pgx5://" + strings.TrimPrefix(pgxURL, "postgresql://")
	}

	m, err := migrate.New("file://"+filepath.ToSlash(abs), pgxURL)
	if err != nil {
		return redactDatabaseURL(fmt.Errorf("migrate open: %w", err), databaseURL, pgxURL)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return redactDatabaseURL(fmt.Errorf("migrate up: %w", err), databaseURL, pgxURL)
	}
	return nil
}

func redactDatabaseURL(err error, urls ...string) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	for _, databaseURL := range urls {
		if databaseURL == "" {
			continue
		}
		msg = strings.ReplaceAll(msg, databaseURL, "postgres://redacted")
		parsed, parseErr := url.Parse(databaseURL)
		if parseErr != nil {
			continue
		}
		password, ok := parsed.User.Password()
		if !ok || password == "" {
			continue
		}
		msg = strings.ReplaceAll(msg, password, "redacted")
		if escaped := url.QueryEscape(password); escaped != password {
			msg = strings.ReplaceAll(msg, escaped, "redacted")
		}
	}
	if msg == err.Error() {
		return err
	}
	return errors.New(msg)
}
