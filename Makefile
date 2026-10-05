SHELL := /bin/bash
-include .env
export

.PHONY: build run dev test test-race env-up env-down migrate-create migrate-up migrate-down migrate-action web host-up host-down db-backup dist-src

build:
	go build -C backend -o ../bin/engmark ./cmd/engmark

run: build
	./bin/engmark

dev: build
	@$(MAKE) env-up
	@set -eu; \
	set -m; \
	api_pid=; \
	web_pid=; \
	cleanup() { \
		trap - INT TERM EXIT; \
		for pgid in $$api_pid $$web_pid; do \
			if [ -n "$$pgid" ]; then kill -TERM -"$$pgid" 2>/dev/null || true; fi; \
		done; \
		sleep 0.4; \
		for pgid in $$api_pid $$web_pid; do \
			if [ -n "$$pgid" ]; then kill -KILL -"$$pgid" 2>/dev/null || true; fi; \
		done; \
		wait 2>/dev/null || true; \
	}; \
	trap cleanup INT TERM EXIT; \
	./bin/engmark & api_pid=$$!; \
	npm run dev --prefix frontend & web_pid=$$!; \
	addr="$${HTTP_ADDR:-:5050}"; \
	case "$$addr" in :*) addr="127.0.0.1$$addr" ;; esac; \
	echo "API http://$$addr"; \
	echo "Study screen http://localhost:5173"; \
	echo "Ctrl+C stops both."; \
	wait

test:
	go test -C backend -timeout 4m ./...

test-race:
	go test -C backend -race -timeout 15m ./...

env-up:
	docker compose up -d --wait --remove-orphans postgres

env-down:
	docker compose down --remove-orphans

migrate-create:
	@if [ -z "$(seq)" ]; then echo "usage: make migrate-create seq=name"; exit 1; fi
	docker compose --profile migrate run --rm engmark-migrate \
		create -ext sql -dir /migrations -seq "$(seq)"

migrate-up:
	@$(MAKE) migrate-action action=up

migrate-down:
	@$(MAKE) migrate-action action=down

migrate-action:
	@docker compose --profile migrate run --rm engmark-migrate \
		-path /migrations \
		-database "postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres:5432/$(POSTGRES_DB)?sslmode=disable" \
		"$(action)"

web:
	npm run dev --prefix frontend

host-up:
	@test -f .env || { echo "Copy .env.example to .env and fill it in."; exit 1; }
	env -i PATH="$$PATH" HOME="$$HOME" ENGMARK_VERSION="$$(git describe --tags --always --dirty 2>/dev/null || echo dev)" ENGMARK_REVISION="$$(git rev-parse HEAD 2>/dev/null || echo unknown)" $${DOCKER_HOST:+DOCKER_HOST="$$DOCKER_HOST"} docker compose --env-file .env -f docker-compose.yaml -p engmark-prod --profile host up -d --build --wait

host-down:
	@test -f .env || { echo "Copy .env.example to .env and fill it in."; exit 1; }
	env -i PATH="$$PATH" HOME="$$HOME" $${DOCKER_HOST:+DOCKER_HOST="$$DOCKER_HOST"} docker compose --env-file .env -f docker-compose.yaml -p engmark-prod --profile host down --remove-orphans

db-backup:
	@test -n "$(POSTGRES_USER)" && test -n "$(POSTGRES_DB)" || { echo "Set POSTGRES_USER and POSTGRES_DB."; exit 1; }
	docker compose exec -T postgres pg_dump -Fc -U "$(POSTGRES_USER)" "$(POSTGRES_DB)" > engmark-backup.dump

dist-src:
	git archive --format=zip HEAD -o engmark-src.zip
