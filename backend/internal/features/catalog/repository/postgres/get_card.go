package catalog_postgres_repository

import (
	"context"
	"errors"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

func (r *Repository) GetCard(ctx context.Context, id int64) (catalog_domain.Card, error) {
	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	query := `SELECT ` + cardColumns + ` FROM cards WHERE id = $1`

	card, err := scanCard(r.pool.QueryRow(ctx, query, id))
	if err != nil {
		if errors.Is(err, core_postgres_pool.ErrNoRows) {
			return catalog_domain.Card{}, fmt.Errorf("card %d: %w", id, core_errors.ErrNotFound)
		}
		return catalog_domain.Card{}, err
	}
	return card, nil
}
