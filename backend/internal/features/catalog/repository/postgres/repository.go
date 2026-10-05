package catalog_postgres_repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
)

const (
	queryTimeout = 10 * time.Second
	syncTimeout  = 60 * time.Second
)

const cardColumns = `
	id,
	deck_id,
	version,
	word,
	translation,
	ipa,
	pronunciation,
	stress_note,
	pos,
	grammar,
	usage,
	example,
	example_highlight,
	example_translation,
	created_at,
	updated_at`

type Repository struct {
	db   core_postgres.DB
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{db: pool, pool: pool}
}

func (r *Repository) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, queryTimeout)
}
