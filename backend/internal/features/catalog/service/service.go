package catalog_service

import (
	"context"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
)

const MaxLimit = catalog_domain.MaxLimit

const (
	defaultAdminLimit    = 50
	maxAdminLimit        = 200
	defaultRevisionLimit = 30
	maxRevisionLimit     = 100
	maxMessageLen        = 500
)

type Repository interface {
	GetAdminDeck(ctx context.Context) (catalog_domain.Deck, error)
	GetDeckSummary(ctx context.Context) (catalog_domain.DeckSummary, error)
	SeedIfEmpty(ctx context.Context, deckID int64, cards []catalog_domain.Card) (bool, error)
	ApplyChangeset(ctx context.Context, deckID int64, cs catalog_domain.Changeset, author, source string) (catalog_domain.ChangesetResult, error)
	GetCard(ctx context.Context, deckID, id int64) (catalog_domain.Card, error)
	GetCards(ctx context.Context, deckID int64, ids []int64) (map[int64]catalog_domain.Card, error)
	ListAdminCards(ctx context.Context, deckID int64, f catalog_domain.CardFilter) (catalog_domain.CardPage, error)
	ExistingKeys(ctx context.Context, deckID int64, keys []catalog_domain.Key) (map[catalog_domain.Key]struct{}, error)
	CurrentState(ctx context.Context, deckID int64) (catalog_domain.DeckState, error)
	ListCardVersions(ctx context.Context, deckID, cardID int64) ([]catalog_domain.CardVersion, error)
	GetCardVersion(ctx context.Context, deckID, cardID int64, version int) (catalog_domain.CardVersion, error)
	ListChangesSince(ctx context.Context, deckID, since int64) (catalog_domain.Changes, error)
	ListRevisions(ctx context.Context, deckID int64, limit int, before int64) ([]catalog_domain.Revision, error)
	GetRevision(ctx context.Context, deckID, revision int64) (catalog_domain.RevisionDetail, error)
	SnapshotAt(ctx context.Context, deckID, revision int64) (catalog_domain.DeckState, error)
}

type Hooks struct {
	OnCommitted      func(ctx context.Context, revision int64)
	SnapshotRevision func() int64
}

type Service struct {
	repo  Repository
	hooks Hooks
}

func New(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) WithHooks(h Hooks) *Service {
	s.hooks = h
	return s
}

func (s *Service) notify(ctx context.Context, revision int64) {
	if s.hooks.OnCommitted != nil {
		s.hooks.OnCommitted(context.WithoutCancel(ctx), revision)
	}
}

func (s *Service) refreshIfLagging(ctx context.Context, dbRevision int64) {
	if s.hooks.SnapshotRevision != nil && s.hooks.SnapshotRevision() < dbRevision {
		s.notify(ctx, dbRevision)
	}
}
