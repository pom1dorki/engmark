-include .env
export

.PHONY: build run start stop-app end test env-up env-down migrate-create migrate-up migrate-down migrate-action import swagger-gen web host-up host-down

build:
	go build -C backend -o ../bin/engmark ./cmd/engmark

run: build
	./bin/engmark

start:
	@$(MAKE) env-up
	@$(MAKE) migrate-up
	@$(MAKE) import
	@$(MAKE) build
	@set -eu; \
	mkdir -p out; \
	addr="$${HTTP_ADDR:-:5050}"; \
	case "$$addr" in :*) addr="127.0.0.1$$addr" ;; esac; \
	if [ -f out/api.pid ] && kill -0 "$$(cat out/api.pid)" 2>/dev/null; then \
		echo "Already running. Stop it with make end." >&2; \
		exit 1; \
	fi; \
	if [ -f out/web.pid ] && kill -0 "$$(cat out/web.pid)" 2>/dev/null; then \
		echo "Already running. Stop it with make end." >&2; \
		exit 1; \
	fi; \
	nohup ./bin/engmark >out/api.log 2>&1 & echo $$! > out/api.pid; \
	nohup npm run dev --prefix frontend >out/web.log 2>&1 & echo $$! > out/web.pid; \
	api_pid=$$(cat out/api.pid); \
	web_pid=$$(cat out/web.pid); \
	ready=0; \
	i=0; \
	while [ "$$i" -lt 40 ]; do \
		if curl -sf --max-time 1 "http://$$addr/healthz" >/dev/null; then ready=1; break; fi; \
		if ! kill -0 "$$api_pid" 2>/dev/null; then \
			echo "API exited before it was ready. See out/api.log" >&2; \
			$(MAKE) stop-app; \
			exit 1; \
		fi; \
		i=$$((i + 1)); \
		sleep 0.25; \
	done; \
	if [ "$$ready" -ne 1 ]; then \
		echo "API did not become ready. See out/api.log" >&2; \
		$(MAKE) stop-app; \
		exit 1; \
	fi; \
	ready=0; \
	i=0; \
	while [ "$$i" -lt 60 ]; do \
		if curl -sf --max-time 1 http://localhost:5173/ >/dev/null; then ready=1; break; fi; \
		if ! kill -0 "$$web_pid" 2>/dev/null; then \
			echo "Study screen exited. See out/web.log" >&2; \
			$(MAKE) stop-app; \
			exit 1; \
		fi; \
		i=$$((i + 1)); \
		sleep 0.25; \
	done; \
	if [ "$$ready" -ne 1 ]; then \
		echo "Study screen did not become ready. See out/web.log" >&2; \
		$(MAKE) stop-app; \
		exit 1; \
	fi; \
	echo "API http://$$addr"; \
	echo "Study screen http://localhost:5173"; \
	echo "Logs: out/api.log out/web.log"; \
	echo "Stop with make end"

stop-app:
	@set -eu; \
	stop_tree() { \
		pid="$$1"; \
		if [ -z "$$pid" ]; then return 0; fi; \
		if ! kill -0 "$$pid" 2>/dev/null; then return 0; fi; \
		for child in $$(pgrep -P "$$pid" 2>/dev/null || true); do \
			stop_tree "$$child"; \
		done; \
		kill -TERM "$$pid" 2>/dev/null || true; \
	}; \
	force_kill() { \
		pid="$$1"; \
		if [ -z "$$pid" ]; then return 0; fi; \
		if kill -0 "$$pid" 2>/dev/null; then kill -KILL "$$pid" 2>/dev/null || true; fi; \
	}; \
	api_pid=""; \
	web_pid=""; \
	if [ -f out/api.pid ]; then api_pid=$$(cat out/api.pid); stop_tree "$$api_pid"; fi; \
	if [ -f out/web.pid ]; then web_pid=$$(cat out/web.pid); stop_tree "$$web_pid"; fi; \
	for pid in $$(lsof -nP -t -iTCP:5050 -sTCP:LISTEN 2>/dev/null || true); do \
		comm=$$(ps -p "$$pid" -o comm= 2>/dev/null || true); \
		case "$$comm" in *engmark*) stop_tree "$$pid" ;; esac; \
	done; \
	for pid in $$(lsof -nP -t -iTCP:5173 -sTCP:LISTEN 2>/dev/null || true); do \
		cmd=$$(ps -p "$$pid" -o args= 2>/dev/null || true); \
		case "$$cmd" in *"/frontend/node_modules/.bin/vite"*) stop_tree "$$pid" ;; esac; \
	done; \
	sleep 0.4; \
	force_kill "$$api_pid"; \
	force_kill "$$web_pid"; \
	for pid in $$(lsof -nP -t -iTCP:5050 -sTCP:LISTEN 2>/dev/null || true); do \
		comm=$$(ps -p "$$pid" -o comm= 2>/dev/null || true); \
		case "$$comm" in *engmark*) force_kill "$$pid" ;; esac; \
	done; \
	for pid in $$(lsof -nP -t -iTCP:5173 -sTCP:LISTEN 2>/dev/null || true); do \
		cmd=$$(ps -p "$$pid" -o args= 2>/dev/null || true); \
		case "$$cmd" in *"/frontend/node_modules/.bin/vite"*) force_kill "$$pid" ;; esac; \
	done; \
	rm -f out/api.pid out/web.pid

end: stop-app
	docker compose --profile dev down --remove-orphans

test:
	go test -C backend -timeout 4m ./...

env-up:
	docker compose --profile dev up -d --wait engmark-postgres

env-down:
	docker compose --profile dev down --remove-orphans engmark-postgres

migrate-create:
	@if [ -z "$(seq)" ]; then echo "usage: make migrate-create seq=name"; exit 1; fi
	docker compose --profile dev run --rm engmark-migrate \
		create -ext sql -dir /migrations -seq "$(seq)"

migrate-up:
	@$(MAKE) migrate-action action=up

migrate-down:
	@$(MAKE) migrate-action action=down

migrate-action:
	@docker compose --profile dev run --rm engmark-migrate \
		-path /migrations \
		-database "postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@engmark-postgres:5432/$(POSTGRES_DB)?sslmode=disable" \
		"$(action)"

import:
	go run -C backend ./cmd/import ../data/cards.json

swagger-gen:
	docker compose --profile dev run --rm engmark-swagger \
		init \
		-g main.go \
		-d ./cmd/engmark,./internal \
		-o docs \
		--parseInternal

web:
	npm run dev --prefix frontend

host-up:
	@test -f .env || { echo "Copy .env.example to .env and fill it in."; exit 1; }
	env -i PATH="$$PATH" HOME="$$HOME" $${DOCKER_HOST:+DOCKER_HOST="$$DOCKER_HOST"} docker compose --env-file .env -p engmark-prod --profile host up -d --build --wait

host-down:
	@test -f .env || { echo "Copy .env.example to .env and fill it in."; exit 1; }
	env -i PATH="$$PATH" HOME="$$HOME" $${DOCKER_HOST:+DOCKER_HOST="$$DOCKER_HOST"} docker compose --env-file .env -p engmark-prod --profile host down --remove-orphans
