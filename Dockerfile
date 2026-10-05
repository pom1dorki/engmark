FROM node:26.10.0-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.27.1-alpine AS api
WORKDIR /src/backend
ARG VERSION=dev
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -tags timetzdata \
    -ldflags="-s -w -X main.version=${VERSION}" \
    -o /out/engmark ./cmd/engmark

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/pom1dorki/engmark" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=api --chown=nonroot:nonroot /out/engmark /usr/local/bin/engmark
COPY --from=web --chown=nonroot:nonroot /src/frontend/dist /srv/engmark
COPY --chown=nonroot:nonroot data/cards.json /data/cards.json
WORKDIR /
EXPOSE 8080
ENV HTTP_ADDR=:8080 \
    HTTP_STATIC_DIR=/srv/engmark \
    LOGGER_LEVEL=info \
    LOGGER_FORMAT=json
ENTRYPOINT ["/usr/local/bin/engmark"]
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=20 \
    CMD ["/usr/local/bin/engmark", "ready"]
