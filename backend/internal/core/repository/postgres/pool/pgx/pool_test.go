package core_pgx_pool

import (
	"net/url"
	"testing"
)

func TestPostgresURLEscapesPassword(t *testing.T) {
	t.Parallel()

	got, err := ConnectionURL(Config{
		Host:     "localhost",
		Port:     "5433",
		User:     "engmark",
		Password: "p@ss:word/?",
		Database: "engmark",
	})
	if err != nil {
		t.Fatal(err)
	}

	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("parse %q: %v", got, err)
	}
	password, ok := parsed.User.Password()
	if !ok || parsed.User.Username() != "engmark" || password != "p@ss:word/?" {
		t.Fatalf("user = %s password ok=%v %q", parsed.User.Username(), ok, password)
	}
	if parsed.Host != "localhost:5433" || parsed.Path != "/engmark" || parsed.Query().Get("sslmode") != "disable" {
		t.Fatalf("url = %s", got)
	}
	if parsed.User.String() == "engmark:p@ss:word/?" {
		t.Fatalf("password was not escaped: %s", got)
	}
}
