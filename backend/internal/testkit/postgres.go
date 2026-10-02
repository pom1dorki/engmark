package testkit

import (
	"context"
	"fmt"
	"path/filepath"
	"runtime"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	core_pgx_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool/pgx"
)

const (
	dbUser = "engmark"
	dbPass = "engmark"
	dbName = "engmark"
)

func Start(ctx context.Context) (*core_pgx_pool.Pool, func(), error) {
	container, err := postgres.Run(ctx, "postgres:18.4-bookworm",
		postgres.WithDatabase(dbName),
		postgres.WithUsername(dbUser),
		postgres.WithPassword(dbPass),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("start postgres: %w", err)
	}
	cleanupContainer := func() { _ = testcontainers.TerminateContainer(container) }

	if err := migrateUp(ctx, container); err != nil {
		cleanupContainer()
		return nil, nil, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		cleanupContainer()
		return nil, nil, fmt.Errorf("postgres host: %w", err)
	}
	mapped, err := container.MappedPort(ctx, "5432/tcp")
	if err != nil {
		cleanupContainer()
		return nil, nil, fmt.Errorf("postgres port: %w", err)
	}

	pool, err := core_pgx_pool.NewPool(ctx, core_pgx_pool.Config{
		Host:     host,
		Port:     mapped.Port(),
		User:     dbUser,
		Password: dbPass,
		Database: dbName,
		Timeout:  5 * time.Second,
		SSLMode:  "disable",
	})
	if err != nil {
		cleanupContainer()
		return nil, nil, err
	}

	cleanup := func() {
		pool.Close()
		cleanupContainer()
	}
	return pool, cleanup, nil
}

func migrateUp(ctx context.Context, container *postgres.PostgresContainer) error {
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		return fmt.Errorf("postgres dsn: %w", err)
	}
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(file), "..", "..", "migrations")
	return core_pgx_pool.MigrateUp(dsn, dir)
}
