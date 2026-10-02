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
	CreatedAt time.Time
}
