package adminauth_postgres_repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	adminauth_domain "github.com/pom1dorki/engmark/internal/features/adminauth/domain"
)

const queryTimeout = 5 * time.Second

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) Create(ctx context.Context, tokenHash []byte, expiresAt time.Time, userAgent string) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	if len(userAgent) > 300 {
		userAgent = userAgent[:300]
	}
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO admin_sessions (token_hash, expires_at, user_agent) VALUES ($1, $2, $3)
	`, tokenHash, expiresAt, userAgent); err != nil {
		return fmt.Errorf("create admin session: %w", err)
	}
	return nil
}

func (r *Repository) Get(ctx context.Context, tokenHash []byte) (adminauth_domain.Session, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	var s adminauth_domain.Session
	err := r.pool.QueryRow(ctx, `
		SELECT expires_at, last_seen_at FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()
	`, tokenHash).Scan(&s.ExpiresAt, &s.LastSeenAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return adminauth_domain.Session{}, fmt.Errorf("admin session: %w", core_errors.ErrUnauthenticated)
		}
		return adminauth_domain.Session{}, fmt.Errorf("get admin session: %w", err)
	}
	return s, nil
}

func (r *Repository) Touch(ctx context.Context, tokenHash []byte, expiresAt time.Time) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	if _, err := r.pool.Exec(ctx, `
		UPDATE admin_sessions SET last_seen_at = now(), expires_at = $2 WHERE token_hash = $1
	`, tokenHash, expiresAt); err != nil {
		return fmt.Errorf("touch admin session: %w", err)
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, tokenHash []byte) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	if _, err := r.pool.Exec(ctx, `DELETE FROM admin_sessions WHERE token_hash = $1`, tokenHash); err != nil {
		return fmt.Errorf("delete admin session: %w", err)
	}
	return nil
}

func (r *Repository) DeleteExpired(ctx context.Context) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	tag, err := r.pool.Exec(ctx, `DELETE FROM admin_sessions WHERE expires_at <= now()`)
	if err != nil {
		return 0, fmt.Errorf("delete expired admin sessions: %w", err)
	}
	return tag.RowsAffected(), nil
}
