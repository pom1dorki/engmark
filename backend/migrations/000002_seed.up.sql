INSERT INTO decks (slug, title)
VALUES ('default', 'Default')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO cards (
    deck_id,
    word,
    translation,
    ipa,
    rus_trans,
    stress,
    pos,
    pos_ru,
    extra_label,
    extra,
    style,
    example,
    example_highlight,
    example_ru
)
SELECT
    d.id,
    v.word,
    v.translation,
    v.ipa,
    v.rus_trans,
    v.stress,
    v.pos,
    v.pos_ru,
    v.extra_label,
    v.extra,
    v.style,
    v.example,
    v.example_highlight,
    v.example_ru
FROM decks d
CROSS JOIN (
    VALUES
        (
            'persist',
            'упорствовать, продолжать (несмотря на трудности)',
            '/pərˈsɪst/',
            '[пэрси́ст]',
            'ударение на 2-м слоге',
            'verb',
            'глагол',
            'Грамматика',
            'Правильный глагол: persist — persisted — persisted.',
            'Нейтральный, чуть формальный. Уместен в учёбе, работе, мотивационных и новостных текстах. Не звучит ни слишком канцелярски, ни слишком разговорно.',
            'If you persist with daily practice, the words will stick.',
            'persist',
            'Если будешь упорно заниматься каждый день, слова закрепятся.'
        ),
        (
            'resilient',
            'устойчивый, способный восстанавливаться',
            '/rɪˈzɪliənt/',
            '[ризи́лиэнт]',
            'ударение на 2-м слоге',
            'adj',
            'прилагательное',
            'Грамматика',
            'Прилагательное. Сравнительная степень: more resilient; превосходная: most resilient.',
            'Нейтральный. Часто в психологии, бизнесе, описании материалов и систем.',
            'Children are remarkably resilient after setbacks.',
            'resilient',
            'Дети удивительно быстро восстанавливаются после неудач.'
        ),
        (
            'glance',
            'быстро взглянуть, бросить взгляд',
            '/ɡlɑːns/',
            '[глаанс]',
            'один слог',
            'verb',
            'глагол',
            'Грамматика',
            'Правильный глагол: glance — glanced — glanced. Часто с предлогом at.',
            'Нейтральный, звучит естественно и в разговоре, и в письме.',
            'She glanced at the clock and hurried out.',
            'glanced',
            'Она взглянула на часы и поспешила выйти.'
        ),
        (
            'thoroughly',
            'тщательно, основательно',
            '/ˈθʌrəli/',
            '[θа́рэли]',
            'ударение на 1-м слоге',
            'adv',
            'наречие',
            'Грамматика',
            'Наречие образа действия, образовано от прилагательного thorough + -ly.',
            'Нейтральный. Часто в инструкциях, отчётах, учебных текстах.',
            'Read the instructions thoroughly before you start.',
            'thoroughly',
            'Внимательно прочитайте инструкции, прежде чем начать.'
        ),
        (
            'threshold',
            'порог, предел; пороговое значение',
            '/ˈθreʃhəʊld/',
            '[θрэ́шхоулд]',
            'ударение на 1-м слоге',
            'noun',
            'существительное',
            'Грамматика',
            'Исчисляемое существительное. Множественное число: thresholds.',
            'Нейтральный и технический. Часто в науке, технике, психологии.',
            'The noise crossed the threshold of what I could ignore.',
            'threshold',
            'Шум перешёл порог того, что я мог игнорировать.'
        )
) AS v (
    word,
    translation,
    ipa,
    rus_trans,
    stress,
    pos,
    pos_ru,
    extra_label,
    extra,
    style,
    example,
    example_highlight,
    example_ru
)
WHERE d.slug = 'default'
ON CONFLICT (deck_id, lower(word), pos, translation) DO NOTHING;