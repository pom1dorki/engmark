package catalog_domain

import "strings"

type Key struct {
	Word        string
	Pos         string
	Translation string
}

func CardKey(c Card) Key {
	return Key{Word: strings.ToLower(c.Word), Pos: c.Pos, Translation: c.Translation}
}

type CardData struct {
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

func (c Card) Data() CardData {
	return CardData{
		Word:               c.Word,
		Translation:        c.Translation,
		IPA:                c.IPA,
		Pronunciation:      c.Pronunciation,
		StressNote:         c.StressNote,
		Pos:                c.Pos,
		Grammar:            c.Grammar,
		Usage:              c.Usage,
		Example:            c.Example,
		ExampleHighlight:   c.ExampleHighlight,
		ExampleTranslation: c.ExampleTranslation,
	}
}

func (d CardData) Card() Card {
	return Card{
		Word:               d.Word,
		Translation:        d.Translation,
		IPA:                d.IPA,
		Pronunciation:      d.Pronunciation,
		StressNote:         d.StressNote,
		Pos:                d.Pos,
		Grammar:            d.Grammar,
		Usage:              d.Usage,
		Example:            d.Example,
		ExampleHighlight:   d.ExampleHighlight,
		ExampleTranslation: d.ExampleTranslation,
	}
}

func (c Card) SameContent(other Card) bool { return c.Data() == other.Data() }
