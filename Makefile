-include .env
export

export PROJECT_ROOT := $(CURDIR)

.PHONY: build run test env-up env-down env-port-forward env-port-close migrate-create migrate-up migrate-down migrate-action swagger-gen

build:
	go build -C backend -o ../bin/engmark ./cmd/engmark

run: build
	./bin/engmark

test:
	go test -C backend -timeout 4m ./...

env-up:
	docker compose up -d --wait engmark-postgres

env-down:
	docker compose down engmark-postgres port-forwarder

env-port-forward:
	docker compose up -d port-forwarder

env-port-close:
	docker compose down port-forwarder

migrate-create:
	@if [ -z "$(seq)" ]; then echo "usage: make migrate-create seq=name"; exit 1; fi
	docker compose run --rm engmark-migrate \
		create -ext sql -dir /migrations -seq "$(seq)"

migrate-up:
	@$(MAKE) migrate-action action=up

migrate-down:
	@$(MAKE) migrate-action action=down

migrate-action:
	docker compose run --rm engmark-migrate \
		-path /migrations \
		-database "postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@engmark-postgres:5432/$(POSTGRES_DB)?sslmode=disable" \
		"$(action)"

swagger-gen:
	docker compose run --rm engmark-swagger \
		init \
		-g main.go \
		-d ./cmd/engmark,./internal \
		-o docs \
		--parseInternal

web:
	npm run dev --prefix frontend