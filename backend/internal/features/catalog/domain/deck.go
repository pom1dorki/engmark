package catalog_domain

import "time"

type Deck struct {
	ID        int64
	Slug      string
	Title     string
	CreatedAt time.Time
}
