package postgres

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pom1dorki/engmark/migrations"
)

type DB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	CopyFrom(ctx context.Context, tableName pgx.Identifier, columnNames []string, rowSrc pgx.CopyFromSource) (int64, error)
}

var (
	_ DB = (*pgxpool.Pool)(nil)
	_ DB = pgx.Tx(nil)
)

func URLFromEnv() (string, error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return "", errors.New("DATABASE_URL is empty")
	}
	if _, err := pgxpool.ParseConfig(databaseURL); err != nil {
		return "", redact(fmt.Errorf("postgres url: %w", err), databaseURL)
	}
	return databaseURL, nil
}

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, redact(fmt.Errorf("postgres url: %w", err), databaseURL)
	}
	if err := applyPoolConfig(cfg); err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, redact(fmt.Errorf("postgres pool: %w", err), databaseURL)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, redact(fmt.Errorf("postgres ping: %w", err), databaseURL)
	}
	return pool, nil
}

func applyPoolConfig(cfg *pgxpool.Config) error {
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second

	if value := strings.TrimSpace(os.Getenv("DB_MAX_CONNS")); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 {
			return fmt.Errorf("DB_MAX_CONNS %q", value)
		}
		cfg.MaxConns = int32(n)
	}
	if value := strings.TrimSpace(os.Getenv("DB_MIN_CONNS")); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 {
			return fmt.Errorf("DB_MIN_CONNS %q", value)
		}
		cfg.MinConns = int32(n)
	}
	if cfg.MinConns > cfg.MaxConns {
		cfg.MinConns = cfg.MaxConns
	}
	if value := strings.TrimSpace(os.Getenv("DB_MAX_CONN_IDLE_TIME")); value != "" {
		d, err := time.ParseDuration(value)
		if err != nil {
			return fmt.Errorf("DB_MAX_CONN_IDLE_TIME: %w", err)
		}
		cfg.MaxConnIdleTime = d
	}
	if value := strings.TrimSpace(os.Getenv("DB_HEALTH_CHECK_PERIOD")); value != "" {
		d, err := time.ParseDuration(value)
		if err != nil {
			return fmt.Errorf("DB_HEALTH_CHECK_PERIOD: %w", err)
		}
		cfg.HealthCheckPeriod = d
	}
	return nil
}

func WithinTx(ctx context.Context, pool *pgxpool.Pool, fn func(context.Context, DB) error) error {
	if pool == nil {
		return errors.New("nested transaction")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

func Migrate(databaseURL string) error {
	if strings.TrimSpace(databaseURL) == "" {
		return errors.New("migrate: database url is required")
	}
	src, err := iofs.New(migrations.Files, ".")
	if err != nil {
		return fmt.Errorf("migrate source: %w", err)
	}
	pgxURL := pgx5URL(databaseURL)
	m, err := migrate.NewWithSourceInstance("iofs", src, pgxURL)
	if err != nil {
		return redact(fmt.Errorf("migrate open: %w", err), databaseURL, pgxURL)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return redact(fmt.Errorf("migrate up: %w", err), databaseURL, pgxURL)
	}
	return nil
}

func pgx5URL(databaseURL string) string {
	switch {
	case strings.HasPrefix(databaseURL, "postgres://"):
		return "pgx5://" + strings.TrimPrefix(databaseURL, "postgres://")
	case strings.HasPrefix(databaseURL, "postgresql://"):
		return "pgx5://" + strings.TrimPrefix(databaseURL, "postgresql://")
	default:
		return databaseURL
	}
}

func redact(err error, urls ...string) error {
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
