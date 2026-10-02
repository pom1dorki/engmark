# Engmark

English vocabulary trainer. Monorepo: Go API in `backend/`, Vite + React in `frontend/`.

- `make start` starts Postgres, migrates, imports `data/cards.json`, then runs the API on `:5050` and the study screen on `:5173` in the background.
- `make end` stops the API and the study screen and removes the Docker containers. Database files in `out/pgdata` stay.
- `make run` builds the API and listens on `:5050`.
- `make web` starts the study screen on `:5173`.
- `make test` runs the Go tests. They need Docker and start their own Postgres.
- `make host-up` builds the server image and runs the site. `make host-down` stops that stack. `make end` does not stop it.

## Run the API

Copy the example and fill in the local values:

```sh
cp .env.example .env
```

In `.env` set `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT=5433`. Postgres is published on `127.0.0.1:5433`. Generate a token and put it in `ADMIN_TOKEN`. An empty token refuses to start. Do not commit the token.

```sh
openssl rand -hex 32
```

```sh
make start
```

`make start` replaces the admin deck from `data/cards.json` on every run and returns to the shell. `make end` stops both servers and removes the containers.

The API listens on `http://localhost:5050`.

- `GET /healthz` is 200 without a database query. The process still pings Postgres on startup and does not listen if that ping fails.
- `GET /readyz` is 200 only after Postgres answers.
- `GET /api/v1/cards?limit=100` returns `items`, `total`, `limit`, and `offset`.

Swagger UI: http://localhost:5050/swagger/index.html

Writes are described there. The header is `Authorization: Bearer <ADMIN_TOKEN>`. Regenerate the contract with `make swagger-gen`. It needs Docker and rewrites only `backend/docs`.

## Add cards

`make migrate-up` creates the tables and one deck, `default`, with `kind` `admin`. `make import` reads `data/cards.json` and replaces the cards in that admin deck. A deck with `kind` `user` is left as it is. `pos` is one of `verb`, `noun`, `adj`, `adv`.

Add one more card with `POST /api/v1/admin/cards` while the API is listening. Omit `deckId` to use the `default` deck. The same call is in Swagger under the admin tag.

```sh
curl -s -X POST http://localhost:5050/api/v1/admin/cards \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"word":"persist","translation":"упорствовать","pos":"verb","example":"If you persist, the words stick.","exampleHighlight":"persist"}'
```

## Study screen

`make start` opens this screen with the API and leaves both running in the background. `make end` stops them. To start only the screen while the API is already listening:

```sh
make web
```

Open http://localhost:5173. Words come from `GET /api/v1/cards`, a page of 100 at a time, until the whole deck is loaded. The next word is a random card that has not appeared yet in this pass. After the last card the deck is shuffled again. The place is remembered in `ew-progress`, and the theme in `ew-theme`.

## Host on a server

The server runs one Docker stack. Caddy serves the study screen and proxies the API on the same host. Postgres listens only on the Docker network. The Go process speaks HTTP inside that network. Caddy terminates TLS when `ENGMARK_SITE` is a domain name.

Install Docker on the server and open ports 80 and 443. Copy the same example there and edit that `.env`. Do not commit it.

```sh
cp .env.example .env
openssl rand -hex 32
```

Put the token in `ADMIN_TOKEN` and replace `POSTGRES_PASSWORD`. Point DNS at the machine, then set:

```
ENGMARK_SITE=words.example.com
HTTP_ALLOWED_ORIGINS=https://words.example.com
```

`HTTP_ALLOWED_ORIGINS` has no path and no trailing slash. For a machine without a domain, leave `ENGMARK_SITE=:80` and set `HTTP_ALLOWED_ORIGINS` to `http://` plus the public IP. `POSTGRES_HOST=localhost` in `.env` is the address for `make start` on a laptop. `make host-up` reaches the bundled Postgres at `postgres:5432` on the Docker network.

```sh
make host-up
```

Open the site. `GET /healthz` and `GET /readyz` are on that same host. Swagger is off. Logs:

```sh
docker compose --env-file .env -p engmark-prod --profile host logs -f app
```

`make host-down` stops the server containers and keeps the database volume. `make end` stops the local API, the study screen, and the local Postgres container. This removes the server volume and the database:

```sh
docker compose --env-file .env -p engmark-prod --profile host down -v
```

Each server start applies migrations and replaces the admin deck from `data/cards.json` in the image. A card added with `POST /api/v1/admin/cards` into that deck is replaced on the next start. Edit `data/cards.json` and run `make host-up` to publish a new catalog. Set `CARDS_FILE` empty in `.env` to leave the admin deck in place across restarts.

`ENGMARK_DB_SSLMODE` defaults to `disable` for Postgres on the private Docker network. A database reached over the internet should use `require`. Set `ENGMARK_DB_HOST` to that host. The bundled Postgres container still starts with the stack. For `verify-ca` or `verify-full`, mount the CA file into the app container and set `POSTGRES_SSLROOTCERT` to its path.

The image builds the screen with an empty `VITE_API_BASE_URL`, so the browser calls `/api/v1/cards` on the site host. The value in the local `.env` is only for `make web`.

## Tests

`make test` runs `go test ./...` in `backend/` and needs Docker. It starts its own Postgres and does not use the database from `make run`.

## CI

Push to `main` and pull requests run `make test`, `npm run build` in `frontend/`, and `docker build` of the server image. No GitHub secret is required.
