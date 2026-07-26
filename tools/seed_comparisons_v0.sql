-- SAR v0 — seed initial specimen_comparisons from Tier-2 markdown ingest.
-- All rows verification_state='pending-verification' — Michael must promote to
-- 'source-locked' after independently reviewing each comparison's quote against
-- the original paper.
--
-- Comparisons drawn from:
--   T2.6 Green 2010 (10.1126/science.1188021) — Vindija Vi33.16 vs Vi33.25, Vi33.16 vs Vi33.26
--   T2.4 Meyer 2014 (10.1038/nature12788) — Sima Femur XIII mtDNA vs Denisova 3 mtDNA
--   T2.5 Peyrégne 2019 (10.1126/sciadv.aaw5873) — Hohlenstein-Stadel/Scladina vs later Neanderthals
--
-- Idempotent: only inserts rows whose (specimen_a, specimen_b, pub, type) key
-- doesn't already exist.

INSERT INTO specimen_comparisons (
    specimen_a_id, specimen_b_id, publication_id, comparison_type,
    claim, claim_source_quote, method, quantitative_result,
    verification_state, verification_notes
)
SELECT * FROM (VALUES
    -- Green 2010: Vi33.16 vs Vi33.25 — different individuals
    (
        'vindija-33-16', 'vindija-33-25', '10.1126/science.1188021',
        'sister-lineage',
        'Different Neandertal individuals; mtDNA differs at 10 positions.',
        'We have previously determined the complete mtDNA sequences from the bones Vi33.16 and Vi33.25, and these differ at 10 positions. Therefore, Vi33.16 and Vi33.25 come from different Neandertal individuals.',
        'aDNA-mitochondrial',
        '10 mtDNA position differences',
        'pending-verification',
        'Autoseed 2026-07-26 from T2.6 Green 2010 ingest markdown.'
    ),
    -- Green 2010: Vi33.16 vs Vi33.26 — same maternal lineage
    (
        'vindija-33-16', 'vindija-33-26', '10.1126/science.1188021',
        'kin-relationship',
        'Same maternal lineage; Vi33.26 consensus matches Vi33.16 at all 10 sites where Vi33.16 differs from Vi33.25.',
        'At all 10 sites where Vi33.16 differs from Vi33.25, the Vi33.26 consensus matches Vi33.16.',
        'aDNA-mitochondrial',
        NULL,
        'pending-verification',
        'Autoseed 2026-07-26 from T2.6 Green 2010 ingest markdown.'
    ),
    -- Meyer 2014 Sima: Femur XIII mtDNA closer to Denisovan than Neanderthal
    (
        'sima-femur-xiii', 'denisova-3', '10.1038/nature12788',
        'sister-lineage',
        'Sima de los Huesos mtDNA shares a common ancestor with Denisovan mtDNAs to the exclusion of Neanderthal, modern human, chimpanzee and bonobo mtDNAs.',
        'All three trees support a topology in which the Sima de los Huesos mtDNA shares a common ancestor with Denisovan mtDNAs to the exclusion of the other mtDNAs analysed.',
        'aDNA-mitochondrial',
        NULL,
        'pending-verification',
        'Autoseed 2026-07-26 from T2.4 Meyer 2014 ingest markdown. Note: interpretation later updated by Meyer 2016 (10.1038/nature17405) — nDNA shows Sima on Neanderthal lineage; mtDNA-Denisovan relationship is ancestral state replaced in Neanderthals.'
    ),
    -- Peyrégne 2019: Hohlenstein-Stadel vs later European Neanderthals
    (
        'hohlenstein-stadel-neanderthal', 'vindija-33-19', '10.1126/sciadv.aaw5873',
        'related-population',
        'Hohlenstein-Stadel Neanderthal is nuclear-genetically closer to later European Neanderthals than to the roughly contemporaneous Altai Neanderthal from Siberia.',
        'both Neandertals are genetically closer to later Neandertals from Europe than to a roughly contemporaneous individual from Siberia.',
        'aDNA-nuclear',
        NULL,
        'pending-verification',
        'Autoseed 2026-07-26 from T2.5 Peyrégne 2019 ingest markdown. Comparison_b vindija-33-19 is a representative later-Neanderthal comparator.'
    ),
    -- Peyrégne 2019: Scladina I-4A vs later European Neanderthals
    (
        'scladina-i-4a', 'vindija-33-19', '10.1126/sciadv.aaw5873',
        'related-population',
        'Scladina I-4A Neanderthal is nuclear-genetically closer to later European Neanderthals than to the roughly contemporaneous Altai Neanderthal from Siberia.',
        'both Neandertals are genetically closer to later Neandertals from Europe than to a roughly contemporaneous individual from Siberia.',
        'aDNA-nuclear',
        NULL,
        'pending-verification',
        'Autoseed 2026-07-26 from T2.5 Peyrégne 2019 ingest markdown.'
    )
) AS incoming(specimen_a_id, specimen_b_id, publication_id, comparison_type,
              claim, claim_source_quote, method, quantitative_result,
              verification_state, verification_notes)
WHERE NOT EXISTS (
    SELECT 1 FROM specimen_comparisons c
    WHERE c.specimen_a_id = incoming.specimen_a_id
      AND c.specimen_b_id = incoming.specimen_b_id
      AND c.publication_id = incoming.publication_id
      AND c.comparison_type = incoming.comparison_type
);
