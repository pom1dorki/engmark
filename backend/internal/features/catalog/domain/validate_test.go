package catalog_domain

import (
	"strings"
	"testing"
)

func fieldCodes(errs []FieldError) []string {
	out := make([]string, len(errs))
	for i, e := range errs {
		out[i] = e.Field + ":" + e.Code
	}
	return out
}

func TestValidateFields(t *testing.T) {
	t.Parallel()

	with := func(mutate func(*Card)) Card {
		c := persistCard()
		mutate(&c)
		return c
	}
	tests := []struct {
		name string
		card Card
		want []string
	}{
		{name: "valid", card: persistCard()},
		{name: "empty word", card: with(func(c *Card) { c.Word = "" }), want: []string{"word:required"}},
		{name: "cyrillic word", card: with(func(c *Card) { c.Word = "слово"; c.ExampleHighlight = "" }), want: []string{"word:invalid_chars"}},
		{name: "double space", card: with(func(c *Card) { c.Word = "a  b" }), want: []string{"word:invalid_chars"}},
		{name: "word too long", card: with(func(c *Card) { c.Word = strings.Repeat("a", maxWord+1); c.ExampleHighlight = "" }), want: []string{"word:too_long"}},
		{name: "no translation", card: with(func(c *Card) { c.Translation = "" }), want: []string{"translation:required"}},
		{name: "translation too long", card: with(func(c *Card) { c.Translation = strings.Repeat("я", maxTranslation+1) }), want: []string{"translation:too_long"}},
		{name: "empty pos", card: with(func(c *Card) { c.Pos = "" }), want: []string{"pos:required"}},
		{name: "unknown pos", card: with(func(c *Card) { c.Pos = "adjective" }), want: []string{"pos:unsupported_pos"}},
		{name: "example too long", card: with(func(c *Card) { c.Example = strings.Repeat("a", maxExample+1); c.ExampleHighlight = "" }), want: []string{"example:too_long"}},
		{name: "note too long", card: with(func(c *Card) { c.Grammar = strings.Repeat("я", maxNote+1) }), want: []string{"grammar:too_long"}},
		{name: "highlight outside example", card: with(func(c *Card) { c.ExampleHighlight = "missing" }), want: []string{"exampleHighlight:highlight_not_found"}},
		{name: "highlight case-insensitive", card: with(func(c *Card) { c.ExampleHighlight = "PERSIST" })},
		{
			name: "several errors at once",
			card: with(func(c *Card) { c.Word = ""; c.Translation = ""; c.Pos = "x"; c.ExampleHighlight = "zzz" }),
			want: []string{"word:required", "translation:required", "pos:unsupported_pos", "exampleHighlight:highlight_not_found"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := fieldCodes(tt.card.ValidateFields())
			if strings.Join(got, ",") != strings.Join(tt.want, ",") {
				t.Fatalf("ValidateFields() = %v, want %v", got, tt.want)
			}
			if err := tt.card.Validate(); (err != nil) != (len(tt.want) > 0) {
				t.Fatalf("Validate() = %v, want error: %v", err, len(tt.want) > 0)
			}
		})
	}
}

func TestCardKey(t *testing.T) {
	t.Parallel()

	a := Card{Word: "Persist", Pos: PosVerb, Translation: "упорствовать"}
	b := Card{Word: "persist", Pos: PosVerb, Translation: "упорствовать", Example: "other fields do not matter"}
	if CardKey(a) != CardKey(b) {
		t.Fatalf("keys differ: %+v vs %+v", CardKey(a), CardKey(b))
	}
	for name, other := range map[string]Card{
		"pos":         {Word: "persist", Pos: PosNoun, Translation: "упорствовать"},
		"translation": {Word: "persist", Pos: PosVerb, Translation: "настаивать"},
		"word":        {Word: "persists", Pos: PosVerb, Translation: "упорствовать"},
	} {
		if CardKey(a) == CardKey(other) {
			t.Fatalf("%s must change the key", name)
		}
	}
}

func TestCardDataRoundTrip(t *testing.T) {
	t.Parallel()
	c := persistCard()
	c.IPA, c.Usage = "/pərˈsɪst/", "нейтральный"
	if got := c.Data().Card(); !got.SameContent(c) {
		t.Fatalf("round trip lost data: %+v", got)
	}
	other := c
	other.Usage = "другое"
	if c.SameContent(other) {
		t.Fatal("SameContent ignored a difference")
	}
}
