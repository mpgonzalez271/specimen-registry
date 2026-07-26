-- Editorial pass #01 — corrections derived directly from source-locked quotes
-- in the ingest markdown, plus site coordinates from authoritative geographic sources
-- (UNESCO World Heritage tentative list, Wikipedia, PNAS SI, Chen 2024 preprint).
--
-- Nothing here promotes to 'source-locked' — that remains gated on Michael's
-- eyeball review of the underlying PDFs. Anything with a source-locked quote
-- inside the ingest file gets promoted from 'draft' → 'pending-verification'.
--
-- Applied: 2026-07-26 (Sun) 13:xx CDT

BEGIN;

-- ============================================================================
-- SITES
-- ============================================================================

-- Denisova Cave: coordinates from UNESCO tentative list + Wikipedia
-- https://whc.unesco.org/en/tentativelists/6625/
UPDATE sites SET
    name = 'Denisova Cave',
    country = 'Russia',
    region = 'Altai Krai, Soloneshensky District',
    latitude = 51.39750,
    longitude = 84.67611,
    coordinates_precision = 'exact',
    site_type = 'karstic cave',
    excavating_institution = 'Institute of Archaeology and Ethnography SB RAS, Novosibirsk',
    verification_state = 'pending-verification'
WHERE id = 'denisova-cave';

-- Chagyrskaya Cave: coordinates from Kolobova et al. 2020 PNAS SI
-- https://www.pnas.org/doi/10.1073/pnas.1918047117
UPDATE sites SET
    name = 'Chagyrskaya Cave',
    country = 'Russia',
    region = 'Altai Krai, Tigirek Ridge (northwestern Altai)',
    latitude = 51.44294,
    longitude = 83.15500,
    coordinates_precision = 'exact',
    site_type = 'karstic cave',
    verification_state = 'pending-verification'
WHERE id = 'chagyrskaya-cave';

-- Baishiya Karst Cave: coordinates from Xia et al. 2024 Nature (UCL preprint)
-- https://discovery.ucl.ac.uk/id/eprint/10194276/
UPDATE sites SET
    name = 'Baishiya Karst Cave',
    country = 'China',
    region = 'Gansu, Xiahe County, Ganjia Basin, northeastern Tibetan Plateau',
    latitude = 35.45000,
    longitude = 102.57000,
    coordinates_precision = '1km',
    site_type = 'karstic cave (high-altitude, 3280 m ASL)',
    verification_state = 'pending-verification'
WHERE id = 'baishiya-karst-cave';

-- ============================================================================
-- SPECIMENS — Denisova 11 ("Denny"): parser matched the wrong specimen table row
-- ============================================================================

-- Correct taxonomic assignment per source-locked quote in T1.5_Slon_2018_Denny.md:
-- "Here we present the genome of 'Denisova 11', a bone fragment from Denisova Cave
--  (Russia) and show that it comes from an individual who had a Neanderthal mother
--  and a Denisovan father."
UPDATE specimens SET
    taxonomic_assignment = 'Neanderthal-Denisovan F1 hybrid',
    taxonomic_assignment_source_quote = 'Here we present the genome of ''Denisova 11'', a bone fragment from Denisova Cave (Russia) and show that it comes from an individual who had a Neanderthal mother and a Denisovan father.',
    assignment_method = 'combined',
    assignment_publication = '10.1038/s41586-018-0455-x',
    provenance_publication = '10.1038/srep23559',
    material_type = 'bone fragment (2.5 cm long-bone shaft fragment, per Brown 2016)',
    stratigraphic_context = '{"raw": "Denisova Cave; layer and chamber to be extracted from Brown 2016 (10.1038/srep23559) SI"}'::jsonb,
    disputed_assignment = false,
    verification_state = 'pending-verification',
    verification_notes = 'Editorial pass 2026-07-26: promoted to pending-verification. Parser initially mis-matched a "notes/hybrid options" table row. Now source-locked quote is correctly attached. Denny is the SAR project''s reference case for hybrid taxonomy — v0 stores this as a single string per T1.5 decision-log Option A.'
WHERE id = 'denisova-11';

-- Denisova 13: T1.7 explicitly says "implied from context — unpublished per Douka 2019"
-- Mark disputed=true and keep in DRAFT because there is NO source-locked quote.
UPDATE specimens SET
    taxonomic_assignment = 'Denisovan (unpublished per Douka 2019 SI)',
    disputed_assignment = true,
    verification_notes = 'Editorial pass 2026-07-26: T1.7 flags this specimen as "unpublished" per Douka 2019 SI section 3. No source-locked quote in a published paper. Kept in DRAFT with disputed=true. Verify current publication status before promoting.'
WHERE id = 'denisova-13';

-- Denisova 14: T1.7 gives us the mtDNA source-locked quote but no explicit taxonomic assignment.
-- Method is aDNA-mitochondrial per the ingest. Keep taxonomy as unspecified.
UPDATE specimens SET
    taxonomic_assignment_source_quote = 'The mtDNA capture data for Denisova 11, Denisova 14 and Denisova 15 are available in the European Nucleotide Archive under accession number PRJEB29061.',
    catalog_number_source_quote = 'ENA PRJEB29061',
    verification_notes = 'Editorial pass 2026-07-26: Douka 2019 (T1.7) provides mtDNA availability quote but no explicit taxonomic assignment in the abstract. Taxonomy remains ''unspecified'' pending Methods/SI extraction. Assignment method (aDNA-mitochondrial) preserved from ingest.'
WHERE id = 'denisova-14';

-- Denisova 15: analogous to Denisova 14, with a GenBank accession quote instead
UPDATE specimens SET
    taxonomic_assignment_source_quote = 'The mtDNA sequence of Denisova 15 can be downloaded from GenBank (accession number MK033602).',
    catalog_number_source_quote = 'GenBank MK033602',
    verification_notes = 'Editorial pass 2026-07-26: Douka 2019 (T1.7) provides GenBank accession quote. Taxonomy remains ''unspecified'' pending Methods/SI extraction.'
WHERE id = 'denisova-15';

-- Denisova 16: only referenced in Extended Data Fig. 1 caption per T1.7
UPDATE specimens SET
    verification_notes = 'Editorial pass 2026-07-26: Douka 2019 (T1.7) only references Denisova 16 in Extended Data Fig. 1 caption. Cannot promote from draft without SI extraction. Keeping as-is.'
WHERE id = 'denisova-16';

-- ============================================================================
-- SPECIMENS with clean source-locked quotes → promote to pending-verification
-- ============================================================================

UPDATE specimens SET
    verification_state = 'pending-verification',
    verification_notes = COALESCE(verification_notes, '') || E'\n\nEditorial pass 2026-07-26: source-locked quote attached from ingest; ready for founder eyeball review against paper PDF.'
WHERE id IN ('denisova-2', 'denisova-3', 'denisova-4', 'denisova-5', 'xiahe-mandible', 'chagyrskaya-8');

-- ============================================================================
-- ANALYSES — clean up the ZooMS-typed row on Denisova 11 that came through as method=NULL
-- ============================================================================

-- The Slon 2018 file lists a "ZooMS" analysis attributed to Brown 2016. Parser
-- couldn't classify "ZooMS" as an analysis method (that's not the same enum
-- as assignment_method), so it came in as NULL. Update the paleoproteomics one
-- to reflect its ZooMS nature in the summary, and drop the NULL-method row it created.

-- Remove the duplicate/empty ZooMS-mtDNA-hybrid analysis (method=NULL, mixes concepts)
DELETE FROM analyses
 WHERE specimen_id = 'denisova-11'
   AND publication_id = '10.1038/srep23559'
   AND method IS NULL;

-- ============================================================================
-- ANALYSES: attach method to the ones that came through as NULL where the
-- ingest source-locked quote makes the method unambiguous
-- ============================================================================

-- xiahe-mandible / Chen 2019: identified by paleoproteomics per the abstract
UPDATE analyses SET
    method = 'paleoproteomics',
    verification_notes = 'Editorial pass 2026-07-26: method attached from Chen 2019 abstract: "a Denisovan mandible, identified by ancient protein analysis" — paleoproteomics.'
WHERE specimen_id = 'xiahe-mandible' AND publication_id = '10.1038/s41586-019-1139-x' AND method IS NULL;

-- denisova-2 / Slon 2017 mtDNA analysis
UPDATE analyses SET
    method = 'aDNA-mitochondrial',
    verification_notes = 'Editorial pass 2026-07-26: method identified as aDNA-mitochondrial per T1.12 result_summary discussion of "missing substitutions in the mitochondrial DNA".'
WHERE specimen_id = 'denisova-2' AND publication_id = '10.1126/sciadv.1700186' AND method IS NULL;

COMMIT;

-- ============================================================================
-- Verification query — run manually
-- ============================================================================
-- SELECT id, verification_state, taxonomic_assignment, assignment_method,
--        taxonomic_assignment_source_quote IS NOT NULL AS has_quote
-- FROM specimens ORDER BY id;
