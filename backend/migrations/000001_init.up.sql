CREATE TABLE decks (
    id         BIGSERIAL PRIMARY KEY,
    slug       TEXT        NOT NULL,
    title      TEXT        NOT NULL,
    -- admin: catalog shipped with the app; make import replaces its cards.
    -- user: a person's deck; import does not touch it.
    kind       TEXT        NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT decks_slug_key UNIQUE (slug),
    CONSTRAINT decks_kind_check CHECK (kind IN ('admin', 'user'))
);

CREATE TABLE cards (
    id                   BIGSERIAL PRIMARY KEY,
    deck_id              BIGINT      NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    version              INT         NOT NULL DEFAULT 1,
    word                 TEXT        NOT NULL,
    translation          TEXT        NOT NULL,
    ipa                  TEXT        NOT NULL DEFAULT '',
    pronunciation        TEXT        NOT NULL DEFAULT '',
    stress_note          TEXT        NOT NULL DEFAULT '',
    pos                  TEXT        NOT NULL,
    grammar              TEXT        NOT NULL DEFAULT '',
    usage                TEXT        NOT NULL DEFAULT '',
    example              TEXT        NOT NULL DEFAULT '',
    example_highlight    TEXT        NOT NULL DEFAULT '',
    example_translation  TEXT        NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cards_pos_check CHECK (pos IN ('verb', 'noun', 'adj', 'adv'))
);

CREATE UNIQUE INDEX cards_deck_word_pos_translation_uidx
    ON cards (deck_id, lower(word), pos, translation);

CREATE INDEX cards_word_lower_idx ON cards (lower(word));

INSERT INTO decks (slug, title, kind)
VALUES ('default', 'Default', 'admin');