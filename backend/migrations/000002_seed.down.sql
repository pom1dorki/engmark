DELETE FROM cards AS c
USING decks AS d
WHERE c.deck_id = d.id
  AND d.slug = 'default'
  AND (
        (lower(c.word) = 'persist'    AND c.pos = 'verb' AND c.translation = 'упорствовать, продолжать (несмотря на трудности)')
     OR (lower(c.word) = 'resilient'  AND c.pos = 'adj'  AND c.translation = 'устойчивый, способный восстанавливаться')
     OR (lower(c.word) = 'glance'     AND c.pos = 'verb' AND c.translation = 'быстро взглянуть, бросить взгляд')
     OR (lower(c.word) = 'thoroughly' AND c.pos = 'adv'  AND c.translation = 'тщательно, основательно')
     OR (lower(c.word) = 'threshold'  AND c.pos = 'noun' AND c.translation = 'порог, предел; пороговое значение')
  );