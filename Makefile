.PHONY: build run

build:
	go build -C backend -o ../bin/engmark ./cmd/engmark

run: build
	./bin/engmark