FROM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Empty API base: the hosted page calls the API on its own origin.
RUN printf 'VITE_API_BASE_URL=\n' > /src/.env.production
ENV VITE_API_BASE_URL=
RUN npm run build \
	&& grep -RqsF "/api/v1/cards?limit=100" dist \
	&& ! grep -RqsF "localhost:5050" dist

FROM golang:1.27.1-alpine AS api
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/engmark ./cmd/engmark

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata wget \
	&& adduser -D -H -u 10001 engmark
COPY --from=api /out/engmark /usr/local/bin/engmark
COPY backend/migrations /migrations
COPY data/cards.json /data/cards.json
COPY --from=web /src/frontend/dist /srv/engmark
USER engmark
EXPOSE 8080
ENV HTTP_ADDR=:8080 \
	HTTP_SHUTDOWN_TIMEOUT=30s \
	HTTP_STATIC_DIR=/srv/engmark \
	HTTP_SWAGGER=false \
	MIGRATIONS_PATH=/migrations \
	CARDS_FILE=/data/cards.json \
	LOGGER_LEVEL=info \
	TIME_ZONE=UTC \
	POSTGRES_PORT=5432 \
	POSTGRES_TIMEOUT=10s \
	POSTGRES_SSLMODE=disable
ENTRYPOINT ["/usr/local/bin/engmark"]
