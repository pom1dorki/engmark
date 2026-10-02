# Engmark

English vocabulary trainer. Monorepo: Go API in `backend/`, Vite + React in `frontend/`.

## Run the API

Copy the example and fill in the local values:

    cp .env.example .env

In `.env` set `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT=5433`. The port-forwarder publishes Postgres on `127.0.0.1:5433`. Generate a token and put it in `ADMIN_TOKEN`. An empty token refuses to start. Do not commit the token.

    openssl rand -hex 32

    make env-up && make env-port-forward && make migrate-up && make run

The API listens on `http://localhost:5050`.

- `GET /healthz` is 200 without the database.
- `GET /readyz` is 200 only after Postgres answers.
- `GET /api/v1/cards?limit=100` returns the seed as `items`, `total`, `limit`, `offset`.

Swagger UI: http://localhost:5050/swagger/index.html

Writes are described there. The header is `Authorization: Bearer <ADMIN_TOKEN>`. Regenerate the contract with `make swagger-gen`. It needs Docker and rewrites only `backend/docs`.

## Study screen

In a second terminal, with the API already listening on `:5050`:

    make web

Open http://localhost:5173. Words come from `GET /api/v1/cards`. The browser shuffles the order. Progress is not saved.

## Tests

`make test` runs `go test ./...` in `backend/` and needs Docker. It starts its own Postgres and does not use the database from `make run`.

## CI

Push and pull request run `make test` and `npm run build` in `frontend/`. No GitHub secret is required.
