CREATE TABLE decks (
    id         BIGSERIAL PRIMARY KEY,
    slug       TEXT        NOT NULL,
    title      TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT decks_slug_key UNIQUE (slug)
);

CREATE TABLE cards (
    id                 BIGSERIAL PRIMARY KEY,
    deck_id            BIGINT      NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
    version            INT         NOT NULL DEFAULT 1,
    word               TEXT        NOT NULL,
    translation        TEXT        NOT NULL,
    ipa                TEXT        NOT NULL DEFAULT '',
    rus_trans          TEXT        NOT NULL DEFAULT '',
    stress             TEXT        NOT NULL DEFAULT '',
    pos                TEXT        NOT NULL,
    pos_ru             TEXT        NOT NULL,
    extra_label        TEXT        NOT NULL DEFAULT 'Грамматика',
    extra              TEXT        NOT NULL DEFAULT '',
    style              TEXT        NOT NULL DEFAULT '',
    example            TEXT        NOT NULL DEFAULT '',
    example_highlight  TEXT        NOT NULL DEFAULT '',
    example_ru         TEXT        NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cards_pos_check CHECK (pos IN ('verb', 'noun', 'adj', 'adv'))
);

CREATE INDEX cards_deck_id_idx ON cards (deck_id);

CREATE UNIQUE INDEX cards_deck_word_pos_translation_uidx
    ON cards (deck_id, lower(word), pos, translation);

CREATE INDEX cards_word_lower_idx ON cards (lower(word));