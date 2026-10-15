package catalog_domain

import "time"

const (
	DeckKindAdmin = "admin"
	DeckKindUser  = "user"
)

type Deck struct {
	ID        int64
	Slug      string
	Title     string
	Kind      string
	Revision  int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

type DeckSummary struct {
	Deck
	ActiveCards   int
	ArchivedCards int
}
