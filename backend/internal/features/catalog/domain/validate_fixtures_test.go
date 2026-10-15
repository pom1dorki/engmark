package catalog_domain

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestValidateFieldsSharedCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/validate_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string   `json:"name"`
		Card   CardData `json:"card"`
		Errors []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 20 {
		t.Fatalf("only %d cases, the fixture file looks truncated", len(cases))
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			card := tc.Card.Card()
			got := make([]string, 0)
			for _, e := range card.ValidateFields() {
				got = append(got, e.Field+":"+e.Code)
			}
			want := make([]string, 0, len(tc.Errors))
			for _, e := range tc.Errors {
				want = append(want, e.Field+":"+e.Code)
			}
			if strings.Join(got, ",") != strings.Join(want, ",") {
				t.Fatalf("ValidateFields() = %v, want %v", got, want)
			}
		})
	}
}
