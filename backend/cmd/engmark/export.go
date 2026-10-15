package main

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"time"

	core_postgres "github.com/pom1dorki/engmark/internal/core/postgres"
	catalog_cardsfile "github.com/pom1dorki/engmark/internal/features/catalog/cardsfile"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_postgres_repository "github.com/pom1dorki/engmark/internal/features/catalog/repository/postgres"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
)

func runExport(args []string, stdout, stderr io.Writer) int {
	if len(args) > 1 {
		fmt.Fprintln(stderr, "usage: engmark export [revision]")
		return 2
	}
	var rev *int64
	if len(args) == 1 {
		text := args[0]
		if len(text) > 1 && (text[0] == 'r' || text[0] == 'R') {
			text = text[1:]
		}
		n, err := strconv.ParseInt(text, 10, 64)
		if err != nil || n < 1 {
			fmt.Fprintf(stderr, "revision %q must be a number like 42 or r42\n", args[0])
			return 2
		}
		rev = &n
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	databaseURL, err := core_postgres.URLFromEnv()
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	pool, err := core_postgres.Open(ctx, databaseURL)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	defer pool.Close()

	state, err := catalog_service.New(catalog_postgres_repository.New(pool)).Export(ctx, rev)
	if err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	cards := make([]catalog_domain.CardData, len(state.Cards))
	for i, c := range state.Cards {
		cards[i] = c.Data
	}
	if err := catalog_cardsfile.Encode(stdout, cards); err != nil {
		fmt.Fprintln(stderr, err.Error())
		return 1
	}
	fmt.Fprintf(stderr, "exported %d cards at r%d\n", len(cards), state.Revision)
	return 0
}
