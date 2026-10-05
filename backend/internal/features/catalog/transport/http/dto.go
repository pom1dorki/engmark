package catalog_transport_http

import (
	"encoding/json"
	"net/http"
	"time"

	core_http_response "github.com/pom1dorki/engmark/internal/core/transport/http/response"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_snapshot "github.com/pom1dorki/engmark/internal/features/catalog/snapshot"
)

type CardDTO struct {
	ID                 int64     `json:"id"`
	DeckID             int64     `json:"deckId"`
	Version            int       `json:"version"`
	Word               string    `json:"word"`
	Translation        string    `json:"translation"`
	IPA                string    `json:"ipa"`
	Pronunciation      string    `json:"pronunciation"`
	StressNote         string    `json:"stressNote"`
	Pos                string    `json:"pos"`
	PosRu              string    `json:"posRu"`
	Grammar            string    `json:"grammar"`
	Usage              string    `json:"usage"`
	Example            string    `json:"example"`
	ExampleHighlight   string    `json:"exampleHighlight"`
	ExampleTranslation string    `json:"exampleTranslation"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type DeckDTO struct {
	ID        int64     `json:"id"`
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Kind      string    `json:"kind"`
	CreatedAt time.Time `json:"createdAt"`
}

type CardListDTO struct {
	Items  []CardDTO `json:"items"`
	Total  int       `json:"total"`
	Limit  int       `json:"limit"`
	Offset int       `json:"offset"`
}

func cardFromDomain(c catalog_domain.Card) CardDTO {
	return CardDTO{
		ID:                 c.ID,
		DeckID:             c.DeckID,
		Version:            c.Version,
		Word:               c.Word,
		Translation:        c.Translation,
		IPA:                c.IPA,
		Pronunciation:      c.Pronunciation,
		StressNote:         c.StressNote,
		Pos:                c.Pos,
		PosRu:              catalog_domain.PosLabel(c.Pos),
		Grammar:            c.Grammar,
		Usage:              c.Usage,
		Example:            c.Example,
		ExampleHighlight:   c.ExampleHighlight,
		ExampleTranslation: c.ExampleTranslation,
		CreatedAt:          c.CreatedAt,
		UpdatedAt:          c.UpdatedAt,
	}
}

func cardsFromDomain(cards []catalog_domain.Card) []CardDTO {
	out := make([]CardDTO, 0, len(cards))
	for _, c := range cards {
		out = append(out, cardFromDomain(c))
	}
	return out
}

func MarshalCardList(items []catalog_domain.Card, total, limit, offset int) ([]byte, error) {
	return json.Marshal(CardListDTO{
		Items:  cardsFromDomain(items),
		Total:  total,
		Limit:  limit,
		Offset: offset,
	})
}

func writeCardPage(resp *core_http_response.HTTPResponseHandler, r *http.Request, page catalog_snapshot.Page) {
	if page.Body != nil {
		resp.CachedBytes(r, page.Body, page.ETag)
		return
	}
	resp.CachedJSON(r, CardListDTO{
		Items:  cardsFromDomain(page.Items),
		Total:  page.Total,
		Limit:  page.Limit,
		Offset: page.Offset,
	})
}

func deckFromDomain(d catalog_domain.Deck) DeckDTO {
	return DeckDTO{
		ID:        d.ID,
		Slug:      d.Slug,
		Title:     d.Title,
		Kind:      d.Kind,
		CreatedAt: d.CreatedAt,
	}
}
