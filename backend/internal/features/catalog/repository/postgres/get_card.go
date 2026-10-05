package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (r *Repository) GetCard(ctx context.Context, id int64) (catalog_domain.Card, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	query := `SELECT ` + cardColumns + ` FROM cards WHERE id = $1`

	card, err := scanCard(r.db.QueryRow(ctx, query, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return catalog_domain.Card{}, fmt.Errorf("card %d: %w", id, core_errors.ErrNotFound)
		}
		return catalog_domain.Card{}, err
	}
	return card, nil
}
