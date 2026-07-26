-- ============================================================
-- Specimen Registry (SAR) — v0.1 Schema DELTA
-- Postgres 15+ (Neon Postgres targeted)
-- Author: Michael Gonzalez (SAR founder)
-- Date: 2026-07-26
-- ============================================================
-- This file captures 5 schema-evolution questions surfaced
-- during the first 12-paper Denisova pilot ingest.
--
-- v0.1 is a PROPOSAL — do not apply to production until
-- Michael's human review sign-off. Some proposals may be
-- rejected or modified. See end of file for open questions.
--
-- Each section is prefixed with `-- ISSUE-N:` linking back
-- to the specific ingest record that surfaced the need.
-- ============================================================

-- Depends on: SCHEMA_v0.sql (base schema)


-- ============================================================
-- ISSUE 1 · Sediment-sample specimens don't fit `specimens` table
-- Surfaced by: T1.4 Slon 2017 (sediment aDNA), T1.10 Zavala 2021
-- ============================================================
-- Problem
-- -------
-- The v0 `specimens` table assumes each row is a discrete fossil
-- with a single taxonomic assignment. Sediment samples aren't that:
-- one sample is a bulk pellet that yields mtDNA fragments from N
-- taxa via mtDNA-capture enrichment. Slon 2017 has 85 samples across
-- 7 sites; Zavala 2021 has ~700 samples from 3 caves. Forcing these
-- into `specimens` inflates the specimen count with things that are
-- not specimens.
--
-- Proposal (DRAFT)
-- ----------------
-- Add a sibling table `sediment_samples` and a table
-- `sediment_taxa_assignments` for the many-to-many linkage.
--
-- Open questions for human review:
--   Q1a. Should `sediment_samples` share a superclass with `specimens`
--        (via inheritance or a common `physical_material` table) so
--        that analyses can reference either kind uniformly?
--   Q1b. What's the canonical unit for sediment counting: sample,
--        stratigraphic layer, or site-layer-year? The papers vary.

CREATE TABLE IF NOT EXISTS sediment_samples (
    id                        text PRIMARY KEY,
    site_id                   text NOT NULL REFERENCES sites(id),
    stratigraphic_layer       text,         -- e.g. "layer 11.4", "layer 15"
    sample_label_from_paper   text,         -- exact label used by authors
    excavation_year           int,          -- year physically collected
    lab                       text,         -- where DNA was extracted
    library_prep_method       text,         -- e.g. "single-strand"
    sequenced_publication_id  text REFERENCES publications(id),
    material_type             text,         -- "cave sediment", "hearth ash"
    mass_mg                   numeric,      -- extract mass when reported
    verification_state        verification_state NOT NULL DEFAULT 'draft',
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sediment_taxa_assignments (
    id                        bigserial PRIMARY KEY,
    sediment_sample_id        text NOT NULL REFERENCES sediment_samples(id),
    taxon                     text NOT NULL,        -- "Denisovan", "Neanderthal", "cave bear", etc.
    detection_method          text NOT NULL,        -- "mtDNA capture", "shotgun"
    fragment_count            int,                  -- unique reads assigned
    coverage                  numeric,              -- if computable
    publication_id            text NOT NULL REFERENCES publications(id),
    source_quote              text,                 -- verbatim from paper
    verification_state        verification_state NOT NULL DEFAULT 'draft',
    created_at                timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sediment_sample_id, taxon, publication_id)
);

-- Discovered dependency: `analyses` may need a polymorphic subject_id
-- (specimen OR sediment_sample). Deferred to v0.2.


-- ============================================================
-- ISSUE 2 · Assignment supersession history (Brown 2016 → Slon 2018)
-- Surfaced by: T1.9 Brown 2016 (Denisova 11 first published as
-- "hominin fragment from bulk-ZooMS") superseded by T1.5 Slon 2018
-- (reassigned as F1 Neanderthal-Denisovan hybrid).
-- ============================================================
-- Problem
-- -------
-- The v0 `specimens.taxonomic_assignment` is a single text field.
-- But real specimens are re-assigned: proteomic → genomic, low-cov
-- → high-cov, morphological hypothesis 1 → hypothesis 2. If we
-- overwrite, we destroy the record of how consensus moved.
--
-- Proposal (DRAFT)
-- ----------------
-- Append-only history table `specimen_assignment_history`.
-- `specimens.taxonomic_assignment` becomes a computed view of the
-- latest non-retracted row in the history table, but the history
-- is what's authoritative.
--
-- Open questions:
--   Q2a. Should morphological reassignments (T1.12 Denisova 2 dm1→dm2)
--        live in the SAME history table or a separate one? Argument
--        for same: they're both "the specimen's identity moved."
--        Argument for separate: taxonomic vs anatomical are different
--        kinds of claim.
--   Q2b. When a specimen is reassigned, which analyses' `analysis`
--        rows need to be marked "assignment now historical"?

CREATE TABLE IF NOT EXISTS specimen_assignment_history (
    id                        bigserial PRIMARY KEY,
    specimen_id               text NOT NULL REFERENCES specimens(id),
    assignment_kind           text NOT NULL,        -- 'taxonomic' | 'morphological' | 'sex' | 'age-class'
    assignment_value          text NOT NULL,        -- e.g. "Denisovan", "F1 hybrid Nea×Den", "dm2 (deciduous 2nd molar)"
    assignment_method         text NOT NULL,        -- e.g. "aDNA-nuclear high-coverage"
    publication_id            text NOT NULL REFERENCES publications(id),
    supersedes_history_id     bigint REFERENCES specimen_assignment_history(id),
    supersession_reason       text,                 -- why this replaces the prior claim
    source_quote              text NOT NULL,        -- verbatim from paper
    is_current                boolean NOT NULL DEFAULT true,
    is_retracted              boolean NOT NULL DEFAULT false,
    verification_state        verification_state NOT NULL DEFAULT 'draft',
    created_at                timestamptz NOT NULL DEFAULT now(),
    UNIQUE (specimen_id, publication_id, assignment_kind)
);

CREATE INDEX IF NOT EXISTS sah_specimen_current_idx
    ON specimen_assignment_history (specimen_id, is_current)
    WHERE is_current = true AND is_retracted = false;


-- ============================================================
-- ISSUE 3 · Study type on publications (chronology vs specimen)
-- Surfaced by: T1.8 Jacobs 2019 (OSL chronology paper; no specimens
-- introduced, no analyses on specific fossils; just dates layers).
-- ============================================================
-- Problem
-- -------
-- v0 `publications` treats every paper as "introduces specimens
-- and/or analyses." Chronology papers, method papers, and review
-- papers don't. Downstream: /corpus route wants to render them
-- differently.
--
-- Proposal (DRAFT)
-- ----------------
-- Add `publications.study_type` enum. Three initial values based
-- on the pilot; more will emerge.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'study_type') THEN
        CREATE TYPE study_type AS ENUM (
            'specimen',    -- introduces one or more specimens (most papers)
            'method',      -- method development or application to sediment/comparison material
            'chronology',  -- dates a site/layer without introducing specimens (T1.8)
            'context',     -- geoarchaeology, occupation history (partial overlap with chronology)
            'review'       -- synthesis of prior work
        );
    END IF;
END$$;

-- Migration note: existing rows in `publications` need to be
-- classified. Best done by human review pass over the 12 pilot
-- papers; the ingest linter already classifies each into
-- {specimen, method, context}, which is a reasonable seed.

ALTER TABLE publications
    ADD COLUMN IF NOT EXISTS study_type study_type;


-- ============================================================
-- ISSUE 4 · Coverage abstract-vs-methods discrepancy tracking
-- Surfaced by: T1.11 Mafessoni 2020 — abstract reports "~27×",
-- methods/results report "27.6×"; distance to Denisova Cave
-- reported as "~100 km" in abstract, "106 km" elsewhere.
-- ============================================================
-- Problem
-- -------
-- A single numeric field can't carry both the abstract's rounded
-- claim and the methods section's precise claim. Both are real,
-- and disagreements between them are informative — sometimes they
-- indicate the paper itself has an internal inconsistency worth
-- flagging.
--
-- Proposal (DRAFT)
-- ----------------
-- Split `analyses.coverage` (and similar quantitative fields)
-- into `_abstract` and `_methods` variants. Keep the base
-- column for the promoted/canonical value; add explicit
-- discrepancy tracking.
--
-- Open questions:
--   Q4a. Which value is "canonical" for public display: methods
--        (more precise) or abstract (author-preferred shorthand)?
--        Michael's editorial call. Suggested default: methods.
--   Q4b. Do we do this for every numeric field, or only when a
--        discrepancy is detected? Cheaper option = only on flag.

ALTER TABLE analyses
    ADD COLUMN IF NOT EXISTS coverage_from_abstract numeric,
    ADD COLUMN IF NOT EXISTS coverage_from_methods  numeric,
    ADD COLUMN IF NOT EXISTS coverage_discrepancy_note text;

-- Similar pattern for other measured quantities as they arise
-- (distances, dates, sample counts). Deferred until a specific
-- discrepancy is observed on ingest.


-- ============================================================
-- ISSUE 5 · Comparison specimens on analyses
-- Surfaced by: T1.11 Mafessoni 2020 — Denisova 11 (mixed-ancestry
-- specimen) analysis explicitly compares against Denisova 3
-- (reference Denisovan), Denisova 5 (Altai Neanderthal), Vindija 33.19
-- (Vindija Neanderthal). These aren't the subject of the analysis
-- but they're required to interpret the analysis. Currently the
-- schema has no place to record them.
-- ============================================================
-- Problem
-- -------
-- Analyses reference other specimens by name in prose; those
-- references are lost when parsed into `analyses`. Downstream
-- consumers (e.g. a specimen page showing "papers that used me as
-- a reference") need this link.
--
-- Proposal (DRAFT)
-- ----------------
-- Explicit link table `analysis_comparison_specimens`.
--
-- Open questions:
--   Q5a. Should we distinguish "reference specimen" (used as ground
--        truth, e.g. Denisova 3 as reference Denisovan) from
--        "comparison specimen" (compared but not privileged)?
--        Provisionally: yes, via a `role` field.

CREATE TABLE IF NOT EXISTS analysis_comparison_specimens (
    id                    bigserial PRIMARY KEY,
    analysis_id           uuid NOT NULL REFERENCES analyses(id),
    comparison_specimen_id text NOT NULL REFERENCES specimens(id),
    role                  text NOT NULL DEFAULT 'comparison', -- 'reference' | 'comparison' | 'outgroup'
    source_quote          text,                 -- how the paper describes the use
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (analysis_id, comparison_specimen_id)
);


-- ============================================================
-- ISSUE 6 · Coverage claim split — abstract vs methods vs SI
-- (Bonus, surfaced during T1.3 Prüfer / T1.11 Mafessoni ingest)
-- ============================================================
-- Deferred to v0.2. The abstract-vs-methods split above handles
-- coverage; but many papers also carry a third (higher-precision)
-- number in SI. For now, capture that in `coverage_discrepancy_note`
-- as free text.


-- ============================================================
-- OPEN QUESTIONS (require Michael sign-off before v0.2)
-- ============================================================
-- Q-A: Should the linter block promotion of DRAFT specimens to
--      source-locked if their referenced site has no site record?
--      T1.6 Chen 2019 introduces Baishiya Karst Cave; site record
--      is inline in T1.6. Do we require a separate seed of the
--      site table before the specimen can be promoted?
--
-- Q-B: For F1-hybrid specimens (Denisova 11), how is
--      `taxonomic_assignment` rendered? Currently v0 has one text
--      value. Options: (a) two rows in specimen_assignment_history,
--      one per parental taxon; (b) a compound value like
--      "Neanderthal×Denisovan F1"; (c) new `hybrid_ancestry` table.
--      Provisionally leaning (a) with a `hybrid_generation` flag.
--
-- Q-C: When two papers publish overlapping specimen sets from the
--      same site (T1.9 Brown 2016 + T1.4 Slon 2017 both introduce
--      Chagyrskaya material), what's the canonical publication for
--      each specimen? Provisionally: first publication that carries
--      a source-locked taxonomic assignment.
--
-- Q-D: Should each analyses row carry a `technique_version` field?
--      Single-strand library methods have improved 2012 → 2019 →
--      2024; papers using the same nominal method have very
--      different sensitivity. Deferred to v0.2.
--
-- Q-E: For sediment analyses, should the `analyses` table
--      support a polymorphic subject (specimen OR sediment_sample)
--      or should sediment analyses live in a parallel
--      `sediment_analyses` table? Deferred to v0.2 pending
--      concrete downstream query patterns.
--
-- ============================================================
-- END v0.1 DELTA
-- ============================================================
