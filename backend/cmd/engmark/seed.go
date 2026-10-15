package main

import (
	"context"
	"errors"
	"os"

	core_logger "github.com/pom1dorki/engmark/internal/core/logger"
	catalog_cardsfile "github.com/pom1dorki/engmark/internal/features/catalog/cardsfile"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	"go.uber.org/zap"
)

type deckSeeder interface {
	AdminDeck(ctx context.Context) (catalog_domain.Deck, error)
	SeedIfEmpty(ctx context.Context, cards []catalog_domain.Card) (bool, error)
}

func seedCatalog(ctx context.Context, log *core_logger.Logger, svc deckSeeder, path string) error {
	deck, err := svc.AdminDeck(ctx)
	if err != nil {
		return err
	}
	log.Info("admin deck", zap.Int64("revision", deck.Revision))

	cards, err := catalog_cardsfile.Read(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		if deck.Revision == 0 {
			log.Warn("cards file not found and the deck is empty: starting with an empty deck", zap.String("path", path))
		} else {
			log.Info("cards file not found: the deck lives in the database", zap.String("path", path))
		}
		return nil
	case err != nil && deck.Revision != 0:
		log.Warn("cards file is unreadable, ignored because the deck already has revisions", zap.String("path", path), zap.Error(err))
		return nil
	case err != nil:
		return err
	}

	seeded, err := svc.SeedIfEmpty(ctx, cards)
	if err != nil {
		return err
	}
	if !seeded {
		log.Info("cards file ignored: the deck already has revisions", zap.String("path", path), zap.Int64("revision", deck.Revision))
		return nil
	}
	log.Info("seeded the admin deck from the cards file", zap.String("path", path), zap.Int("cards", len(cards)))
	return nil
}
