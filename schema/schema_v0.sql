-- ============================================================
-- Specimen Registry (SAR) — v0 Schema DDL
-- Postgres 15+ (Neon Postgres targeted)
-- ============================================================
-- Design principles:
-- 1. Append-only for scientific record — analyses are added, not overwritten.
-- 2. Every user-facing field has a paired _source_quote column where feasible.
-- 3. Every publication is traceable to a DOI; every specimen to a publication.
-- 4. Verification state is explicit and audit-logged.
-- 5. Full-text search across specimens, publications, sites via Postgres FTS.
-- ============================================================

-- Enum for verification state — controls what shows publicly
CREATE TYPE verification_state AS ENUM (
    'draft',              -- ingest in progress; not visible on public site
    'pending-verification', -- ingested; awaiting Michael's sample review
    'source-locked',      -- verified against primary source; visible publicly
    'disputed',           -- source-lock passed but community consensus is contested
    'retracted'           -- paper retracted or superseded; kept for historical record
);

-- Enum for taxonomic assignment methods
CREATE TYPE assignment_method AS ENUM (
    'morphology-2D',           -- classical morphometric description
    'morphology-3D',           -- micro-CT, geometric morphometrics
    'aDNA-mitochondrial',      -- mtDNA sequencing
    'aDNA-nuclear',            -- nuclear genome sequencing
    'aDNA-shotgun',            -- shotgun DNA screening
    'paleoproteomics',         -- ZooMS or MS/MS peptide identification
    'sediment-DNA',            -- eDNA from sediment
    'stratigraphic-association', -- inferred from associated material
    'combined'                 -- multi-method (spelled out in notes)
);

-- Enum for dating methods
CREATE TYPE dating_method AS ENUM (
    'radiocarbon-AMS',
    'radiocarbon-conventional',
    'u-series',
    'u-th',
    'esr',
    'osl',                     -- optically stimulated luminescence
    'tl',                      -- thermoluminescence
    'ar-ar',                   -- argon-argon
    'bayesian-modeling',       -- combined stratigraphic + chronometric
    'faunal-biochronology',
    'associated'               -- age-by-association only
);

-- ============================================================
-- Sites — geographic locations with specimens
-- ============================================================
CREATE TABLE sites (
    id                   TEXT PRIMARY KEY,          -- slug like 'denisova-cave', 'sima-de-los-huesos'
    name                 TEXT NOT NULL,             -- 'Denisova Cave'
    country              TEXT NOT NULL,             -- 'Russia'
    region               TEXT,                      -- 'Altai Mountains'
    latitude             NUMERIC(9,6),              -- decimal degrees; null if intentionally withheld
    longitude            NUMERIC(9,6),
    coordinates_precision TEXT CHECK (coordinates_precision IN ('exact', '1km', '10km', 'country-only', 'withheld')),
    site_type            TEXT,                      -- 'cave', 'open-air', 'rock-shelter'
    excavating_institution TEXT,                    -- e.g. 'IAET SB RAS Novosibirsk'
    notes                TEXT,
    verification_state   verification_state NOT NULL DEFAULT 'draft',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Publications — every peer-reviewed source
-- ============================================================
CREATE TABLE publications (
    id                   TEXT PRIMARY KEY,          -- DOI, format '10.1038/nature09710'
    title                TEXT NOT NULL,
    authors              JSONB NOT NULL,            -- ordered array of author objects (family, given, orcid, affiliation)
    year                 INTEGER NOT NULL CHECK (year BETWEEN 1800 AND 2100),
    journal              TEXT NOT NULL,
    volume               TEXT,
    issue                TEXT,
    pages                TEXT,
    publication_date     DATE,
    open_access_url      TEXT,
    pmc_id               TEXT,                      -- PubMed Central ID if available
    pubmed_id            TEXT,
    abstract             TEXT,                      -- verbatim
    crossref_verified_at TIMESTAMPTZ,               -- when byline was last verified against Crossref
    verification_state   verification_state NOT NULL DEFAULT 'draft',
    verification_notes   TEXT,
    fts_tsv              tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(abstract, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(authors::text, '')), 'C')
    ) STORED,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX publications_fts_idx ON publications USING GIN (fts_tsv);
CREATE INDEX publications_year_idx ON publications (year);
CREATE INDEX publications_verification_idx ON publications (verification_state);

-- ============================================================
-- Specimens — the core registry
-- ============================================================
CREATE TABLE specimens (
    id                     TEXT PRIMARY KEY,          -- 'denisova-3', 'sima-cranium-5', 'cobra-cave-tth-2'
    site_id                TEXT NOT NULL REFERENCES sites(id),
    common_name            TEXT NOT NULL,             -- 'Denisova 3', 'Denny', 'Sima-5'
    community_name         TEXT,                      -- nickname or alternate reference
    catalog_number         TEXT,                      -- museum/institutional accession
    catalog_number_source_quote TEXT,
    material_type          TEXT,                      -- 'phalanx', 'molar', 'cranium', 'mtDNA-fragment'
    taxonomic_assignment   TEXT NOT NULL,             -- 'Denisovan' | 'Neanderthal' | 'Neanderthal-Denisovan F1 hybrid' | 'Homo sapiens' | 'unassigned' | 'Homo sp.'
    taxonomic_assignment_source_quote TEXT,
    assignment_method      assignment_method,
    assignment_publication TEXT REFERENCES publications(id),  -- paper that formally made the assignment
    provenance_publication TEXT REFERENCES publications(id),  -- earliest paper that reported the specimen
    stratigraphic_context  JSONB,                     -- {"chamber": "...", "layer": "...", "excavation_year": ..., "notes": "..."}
    stratigraphic_context_source_quote TEXT,
    current_custody        TEXT,                      -- 'IAET SB RAS Novosibirsk', 'MNHN Paris', etc.
    inferred_fields        TEXT[],                    -- fields whose values are inferred rather than source-locked
    disputed_assignment    BOOLEAN NOT NULL DEFAULT FALSE,
    verification_state     verification_state NOT NULL DEFAULT 'draft',
    verification_notes     TEXT,
    fts_tsv                tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(common_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(community_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(taxonomic_assignment, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(material_type, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(current_custody, '')), 'C')
    ) STORED,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX specimens_site_idx ON specimens (site_id);
CREATE INDEX specimens_taxa_idx ON specimens (taxonomic_assignment);
CREATE INDEX specimens_fts_idx ON specimens USING GIN (fts_tsv);
CREATE INDEX specimens_verification_idx ON specimens (verification_state);

-- ============================================================
-- Analyses — every study, dating attempt, or sequencing run
-- ============================================================
CREATE TABLE analyses (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_id           TEXT NOT NULL REFERENCES specimens(id),
    publication_id        TEXT NOT NULL REFERENCES publications(id),
    method                assignment_method,
    dating_method         dating_method,
    lab                   TEXT,                      -- 'Max Planck Leipzig', 'Oxford ORAU'
    analysis_date         DATE,                      -- when the analysis was performed (if known)
    result_summary        TEXT NOT NULL,             -- 2-3 sentences
    result_summary_source_quote TEXT,
    result_data_link      TEXT,                      -- ENA/GenBank/PANGAEA accession or URL
    age_estimate_lower_ka NUMERIC,                   -- in thousands of years
    age_estimate_upper_ka NUMERIC,
    age_estimate_notes    TEXT,
    verification_state    verification_state NOT NULL DEFAULT 'draft',
    verification_notes    TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX analyses_specimen_idx ON analyses (specimen_id);
CREATE INDEX analyses_publication_idx ON analyses (publication_id);
CREATE INDEX analyses_method_idx ON analyses (method);
CREATE INDEX analyses_dating_idx ON analyses (dating_method);

-- ============================================================
-- Ingest audit log — every ingest attempt tracked
-- ============================================================
CREATE TABLE ingest_audit (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingester              TEXT NOT NULL,             -- 'Michael Gonzalez' or 'AI-assisted (Claude)'
    started_at            TIMESTAMPTZ NOT NULL,
    completed_at          TIMESTAMPTZ,
    publication_ids       TEXT[] NOT NULL,           -- DOIs ingested in this session
    urls_fetched          JSONB NOT NULL,            -- array of {url, timestamp}
    crossref_queries      JSONB,                     -- array of DOIs verified against Crossref
    flagged_fields        JSONB,                     -- fields marked for human review
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Sample seed data — Denisova Cave pilot
-- ============================================================

INSERT INTO sites (id, name, country, region, site_type, excavating_institution, verification_state) VALUES
    ('denisova-cave', 'Denisova Cave', 'Russia', 'Altai Mountains, southern Siberia', 'cave', 'IAET SB RAS Novosibirsk', 'source-locked');

-- Publications, specimens, and analyses will be inserted via ingest workflow
-- based on records in /home/user/workspace/sar/02_denisova_pilot/paper_ingest/
