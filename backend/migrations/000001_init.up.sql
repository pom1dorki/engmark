CREATE TABLE decks (
    id         BIGSERIAL PRIMARY KEY,
    slug       TEXT        NOT NULL UNIQUE,
    title      TEXT        NOT NULL,
    kind       TEXT        NOT NULL DEFAULT 'user' CHECK (kind IN ('admin', 'user')),
    revision   BIGINT      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX decks_single_admin ON decks ((kind)) WHERE kind = 'admin';

CREATE TABLE deck_revisions (
    deck_id        BIGINT      NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    revision       BIGINT      NOT NULL,
    base_revision  BIGINT      NOT NULL,
    author         TEXT        NOT NULL,
    message        TEXT        NOT NULL DEFAULT '',
    source         TEXT        NOT NULL DEFAULT 'editor',
    created_n      INT         NOT NULL DEFAULT 0,
    updated_n      INT         NOT NULL DEFAULT 0,
    archived_n     INT         NOT NULL DEFAULT 0,
    restored_n     INT         NOT NULL DEFAULT 0,
    imported_files JSONB       NOT NULL DEFAULT '[]',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (deck_id, revision)
);

CREATE TABLE cards (
    id                  BIGSERIAL PRIMARY KEY,
    deck_id             BIGINT      NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    version             INT         NOT NULL DEFAULT 1,
    word                TEXT        NOT NULL,
    translation         TEXT        NOT NULL,
    ipa                 TEXT        NOT NULL DEFAULT '',
    pronunciation       TEXT        NOT NULL DEFAULT '',
    stress_note         TEXT        NOT NULL DEFAULT '',
    pos                 TEXT        NOT NULL CHECK (pos IN ('verb', 'noun', 'adj', 'adv')),
    grammar             TEXT        NOT NULL DEFAULT '',
    usage               TEXT        NOT NULL DEFAULT '',
    example             TEXT        NOT NULL DEFAULT '',
    example_highlight   TEXT        NOT NULL DEFAULT '',
    example_translation TEXT        NOT NULL DEFAULT '',
    archived_at         TIMESTAMPTZ NULL,
    created_revision    BIGINT      NOT NULL,
    updated_revision    BIGINT      NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cards_active_key_uidx
    ON cards (deck_id, lower(word), pos, translation) WHERE archived_at IS NULL;

CREATE INDEX cards_deck_updated_rev_idx ON cards (deck_id, updated_revision);

CREATE TABLE card_versions (
    card_id    BIGINT      NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    version    INT         NOT NULL,
    deck_id    BIGINT      NOT NULL,
    revision   BIGINT      NOT NULL,
    data       JSONB       NOT NULL,
    archived   BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (card_id, version),
    FOREIGN KEY (deck_id, revision) REFERENCES deck_revisions (deck_id, revision)
);

CREATE INDEX card_versions_deck_rev_idx ON card_versions (deck_id, revision);

CREATE TABLE admin_sessions (
    token_hash   BYTEA       PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    user_agent   TEXT        NOT NULL DEFAULT ''
);

INSERT INTO decks (slug, title, kind)
VALUES ('default', 'Default', 'admin');
