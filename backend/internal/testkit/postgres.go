package testkit

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
)

const (
	dbUser = "engmark"
	dbPass = "engmark"
	dbName = "engmark"
)

func Start(ctx context.Context) (*pgxpool.Pool, func(), error) {
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

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		cleanupContainer()
		return nil, nil, fmt.Errorf("postgres dsn: %w", err)
	}
	if err := core_postgres.Migrate(dsn); err != nil {
		cleanupContainer()
		return nil, nil, err
	}

	pool, err := core_postgres.Open(ctx, dsn)
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
