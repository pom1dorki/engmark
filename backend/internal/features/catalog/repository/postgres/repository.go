package catalog_postgres_repository

import (
	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
)

const cardColumns = `
	id,
	deck_id,
	version,
	word,
	translation,
	ipa,
	rus_trans,
	stress,
	pos,
	pos_ru,
	extra_label,
	extra,
	style,
	example,
	example_highlight,
	example_ru,
	created_at,
	updated_at`

type Repository struct {
	pool core_postgres_pool.Pool
}

func New(pool core_postgres_pool.Pool) *Repository {
	return &Repository{pool: pool}
}
