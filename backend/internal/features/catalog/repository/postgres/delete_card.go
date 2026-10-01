package catalog_postgres_repository

import (
	"context"
	"fmt"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
)

func (r *Repository) DeleteCard(ctx context.Context, id int64) error {
	if _, err := r.GetCard(ctx, id); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, r.pool.OpTimeout())
	defer cancel()

	tag, err := r.pool.Exec(ctx, `DELETE FROM cards WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete card %d: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("card %d: %w", id, core_errors.ErrNotFound)
	}
	return nil
}
