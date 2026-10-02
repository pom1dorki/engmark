package main

import (
	"context"
	"fmt"
	"os"

	core_postgres_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool"
	core_pgx_pool "github.com/pom1dorki/engmark/internal/core/repository/postgres/pool/pgx"
	catalog_cardsfile "github.com/pom1dorki/engmark/internal/features/catalog/cardsfile"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: import cards.json")
		os.Exit(2)
	}

	cards, err := catalog_cardsfile.Read(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	cfg, err := core_pgx_pool.NewConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "postgres config:", err)
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := core_pgx_pool.NewPool(ctx, cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "postgres:", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := importCards(ctx, pool, cards); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("replaced admin deck with %d cards\n", len(cards))
}

func importCards(ctx context.Context, pool core_postgres_pool.Pool, cards []catalog_domain.Card) error {
	svc := catalog_service.New(catalog_postgres_repository.New(pool))
	return svc.ReplaceAdminCards(ctx, cards)
}
