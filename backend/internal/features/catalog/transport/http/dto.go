package catalog_transport_http

import (
	"time"

	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
)

type cardDTO struct {
	ID               int64     `json:"id"`
	DeckID           int64     `json:"deckId"`
	Version          int       `json:"version"`
	Word             string    `json:"word"`
	Translation      string    `json:"translation"`
	IPA              string    `json:"ipa"`
	RusTrans         string    `json:"rusTrans"`
	Stress           string    `json:"stress"`
	Pos              string    `json:"pos"`
	PosRu            string    `json:"posRu"`
	ExtraLabel       string    `json:"extraLabel"`
	Extra            string    `json:"extra"`
	Style            string    `json:"style"`
	Example          string    `json:"example"`
	ExampleHighlight string    `json:"exampleHighlight"`
	ExampleRu        string    `json:"exampleRu"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type deckDTO struct {
	ID        int64     `json:"id"`
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
}

type cardListDTO struct {
	Items  []cardDTO `json:"items"`
	Total  int       `json:"total"`
	Limit  int       `json:"limit"`
	Offset int       `json:"offset"`
}

func cardFromDomain(c catalog_domain.Card) cardDTO {
	return cardDTO{
		ID:               c.ID,
		DeckID:           c.DeckID,
		Version:          c.Version,
		Word:             c.Word,
		Translation:      c.Translation,
		IPA:              c.IPA,
		RusTrans:         c.RusTrans,
		Stress:           c.Stress,
		Pos:              c.Pos,
		PosRu:            c.PosRu,
		ExtraLabel:       c.ExtraLabel,
		Extra:            c.Extra,
		Style:            c.Style,
		Example:          c.Example,
		ExampleHighlight: c.ExampleHighlight,
		ExampleRu:        c.ExampleRu,
		CreatedAt:        c.CreatedAt,
		UpdatedAt:        c.UpdatedAt,
	}
}

func cardsFromDomain(cards []catalog_domain.Card) []cardDTO {
	out := make([]cardDTO, 0, len(cards))
	for _, c := range cards {
		out = append(out, cardFromDomain(c))
	}
	return out
}

func cardListFromService(list catalog_service.CardList) cardListDTO {
	return cardListDTO{
		Items:  cardsFromDomain(list.Items),
		Total:  list.Total,
		Limit:  list.Limit,
		Offset: list.Offset,
	}
}

func deckFromDomain(d catalog_domain.Deck) deckDTO {
	return deckDTO{
		ID:        d.ID,
		Slug:      d.Slug,
		Title:     d.Title,
		CreatedAt: d.CreatedAt,
	}
}
