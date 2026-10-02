package catalog_transport_http

import (
	"encoding/json"
	"fmt"
	"time"

	core_errors "github.com/pom1dorki/engmark/internal/core/errors"
	catalog_domain "github.com/pom1dorki/engmark/internal/features/catalog/domain"
	catalog_service "github.com/pom1dorki/engmark/internal/features/catalog/service"
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

func cardListFromService(list catalog_service.CardList) CardListDTO {
	return CardListDTO{
		Items:  cardsFromDomain(list.Items),
		Total:  list.Total,
		Limit:  list.Limit,
		Offset: list.Offset,
	}
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

type setString struct {
	value catalog_domain.Nullable[string]
}

func (s *setString) UnmarshalJSON(data []byte) error {
	s.value.Set = true
	if string(data) == "null" {
		empty := ""
		s.value.Value = &empty
		return nil
	}
	var v string
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	s.value.Value = &v
	return nil
}

type CreateCardRequest struct {
	DeckID             *int64 `json:"deckId"`
	Word               string `json:"word"`
	Translation        string `json:"translation"`
	IPA                string `json:"ipa"`
	Pronunciation      string `json:"pronunciation"`
	StressNote         string `json:"stressNote"`
	Pos                string `json:"pos"`
	Grammar            string `json:"grammar"`
	Usage              string `json:"usage"`
	Example            string `json:"example"`
	ExampleHighlight   string `json:"exampleHighlight"`
	ExampleTranslation string `json:"exampleTranslation"`
}

func (in CreateCardRequest) card() catalog_domain.Card {
	return catalog_domain.Card{
		Word:               in.Word,
		Translation:        in.Translation,
		IPA:                in.IPA,
		Pronunciation:      in.Pronunciation,
		StressNote:         in.StressNote,
		Pos:                in.Pos,
		Grammar:            in.Grammar,
		Usage:              in.Usage,
		Example:            in.Example,
		ExampleHighlight:   in.ExampleHighlight,
		ExampleTranslation: in.ExampleTranslation,
	}
}

type PatchCardRequest struct {
	Version            *int      `json:"version"`
	Word               setString `json:"word" swaggertype:"string"`
	Translation        setString `json:"translation" swaggertype:"string"`
	IPA                setString `json:"ipa" swaggertype:"string"`
	Pronunciation      setString `json:"pronunciation" swaggertype:"string"`
	StressNote         setString `json:"stressNote" swaggertype:"string"`
	Pos                setString `json:"pos" swaggertype:"string"`
	Grammar            setString `json:"grammar" swaggertype:"string"`
	Usage              setString `json:"usage" swaggertype:"string"`
	Example            setString `json:"example" swaggertype:"string"`
	ExampleHighlight   setString `json:"exampleHighlight" swaggertype:"string"`
	ExampleTranslation setString `json:"exampleTranslation" swaggertype:"string"`
}

func (in PatchCardRequest) patch() (catalog_domain.CardPatch, error) {
	if in.Version == nil {
		return catalog_domain.CardPatch{}, fmt.Errorf("version is required: %w", core_errors.ErrInvalidArgument)
	}
	return catalog_domain.CardPatch{
		Version:            *in.Version,
		Word:               in.Word.value,
		Translation:        in.Translation.value,
		IPA:                in.IPA.value,
		Pronunciation:      in.Pronunciation.value,
		StressNote:         in.StressNote.value,
		Pos:                in.Pos.value,
		Grammar:            in.Grammar.value,
		Usage:              in.Usage.value,
		Example:            in.Example.value,
		ExampleHighlight:   in.ExampleHighlight.value,
		ExampleTranslation: in.ExampleTranslation.value,
	}, nil
}
