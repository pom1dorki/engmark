package catalog_service

import (
	"context"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

const MaxLimit = catalog_domain.MaxLimit

type Repository interface {
	GetAdminDeck(ctx context.Context) (catalog_domain.Deck, error)
	ReplaceDeckCards(ctx context.Context, deckID int64, cards []catalog_domain.Card, sourceSHA256 string) error
}

type Service struct {
	repo Repository
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}
