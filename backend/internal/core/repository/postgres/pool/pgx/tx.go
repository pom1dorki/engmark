package core_pgx_pool

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
)

func (p *Pool) WithinTx(ctx context.Context, fn func(context.Context, core_postgres_pool.Pool) error) error {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	if err := fn(ctx, &txPool{tx: tx, opTimeout: p.opTimeout}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

type txPool struct {
	tx        pgx.Tx
	opTimeout time.Duration
}

func (p *txPool) Query(ctx context.Context, sql string, args ...any) (core_postgres_pool.Rows, error) {
	rows, err := p.tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgxRows{rows}, nil
}

func (p *txPool) QueryRow(ctx context.Context, sql string, args ...any) core_postgres_pool.Row {
	return pgxRow{p.tx.QueryRow(ctx, sql, args...)}
}

func (p *txPool) Exec(ctx context.Context, sql string, args ...any) (core_postgres_pool.CommandTag, error) {
	tag, err := p.tx.Exec(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgxCommandTag{tag}, nil
}

func (p *txPool) Ping(ctx context.Context) error {
	return p.tx.Conn().Ping(ctx)
}

func (p *txPool) Close() {}

func (p *txPool) OpTimeout() time.Duration {
	return p.opTimeout
}

func (p *txPool) WithinTx(context.Context, func(context.Context, core_postgres_pool.Pool) error) error {
	return errors.New("nested transaction")
}
