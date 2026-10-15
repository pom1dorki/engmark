package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
)

const (
	queryTimeout = 10 * time.Second
	writeTimeout = 60 * time.Second

	activeKeyIndex = "cards_active_key_uidx"
)

var cardColumnNames = []string{
	"id", "deck_id", "version", "word", "translation", "ipa", "pronunciation", "stress_note",
	"pos", "grammar", "usage", "example", "example_highlight", "example_translation",
	"archived_at", "created_revision", "updated_revision", "created_at", "updated_at",
}

var cardColumns = strings.Join(cardColumnNames, ", ")

func cardColumnsAs(alias string) string {
	cols := make([]string, len(cardColumnNames))
	for i, name := range cardColumnNames {
		cols[i] = alias + "." + name
	}
	return strings.Join(cols, ", ")
}

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

func (r *Repository) readTx(ctx context.Context, fn func(ctx context.Context, db core_postgres.DB) error) error {
	if r.pool == nil {
		return fn(ctx, r.db)
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("begin read transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit read transaction: %w", err)
	}
	return nil
}

func isActiveKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == activeKeyIndex
}
