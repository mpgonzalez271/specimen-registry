# SAR — Autonomous Block Summary (2026-07-26)

**Block window:** ~10:00 CDT to ~12:00 CDT (Michael at church)
**Standing rules honored:** No external contact. No lowered thresholds. All specialist exclusions respected. Every DOI/byline verified against Crossref before commit.

## What got done

### 1. Nine tier-1 paper ingest records written and verified

All committed under `corpus/denisova/` in `mpgonzalez271/specimen-registry`, each following the T1.5 template shape (publication table, verbatim abstract, specimen records with source-locked quoted passages, analysis records, cross-references, pending human-review checklist). Byline data extracted from Crossref JSON, not paraphrased.

| ID | Paper | Key specimen(s) | Verified via |
|---|---|---|---|
| T1.2 | Meyer 2012 (Science) | Denisova 3 — 30× genome, single-strand library | Crossref DOI 10.1126/science.1224344 |
| T1.3 | Prüfer 2014 (Nature) | Denisova 5 (Altai Neanderthal) — 52× genome, half-siblings finding | Crossref DOI 10.1038/nature12886 |
| T1.4 | Slon 2017 (Science) | 85 sediment samples across 7 sites — sediment-DNA method | Crossref DOI 10.1126/science.aam9695 |
| T1.6 | Chen 2019 (Nature) | Xiahe mandible / Baishiya Karst Cave — ≥160 ka U-series | Crossref DOI 10.1038/s41586-019-1139-x |
| T1.8 | Jacobs 2019 (Nature) | Denisova Cave OSL chronology — 47 samples across 3 chambers | Crossref DOI 10.1038/s41586-018-0843-2 |
| T1.9 | Brown 2016 (Sci Rep) | Denisova 11 — ZooMS from 2,000+ bones, one hominin hit | Crossref DOI 10.1038/srep23559 |
| T1.10 | Zavala 2021 (Nature) | 728 sediment samples Denisova Cave — 685 faunal / 175 hominin mtDNA-positive | Crossref DOI 10.1038/s41586-021-03675-0 |
| T1.11 | Mafessoni 2020 (PNAS) | Chagyrskaya 8 — 27× phalanx, striatum finding | Crossref DOI 10.1073/pnas.2004944117 |
| T1.12 | Slon 2017 (Sci Adv) | Denisova 2 — dm2 deciduous molar, 51× mtDNA | Crossref DOI 10.1126/sciadv.1700186 |

Combined with the three pre-existing records (T1.1 Reich 2010, T1.5 Slon 2018 Denny, T1.7 Douka 2019), the Denisova Cave pilot corpus now has **12 tier-1 papers ingested to DRAFT state**, awaiting human promotion to `source-locked`.

### 2. Data-integrity flags surfaced during ingest

Recorded inside individual ingest files, not silently smoothed over:

- **T1.3 Prüfer 2014:** Crossref reports online publication date 2013-12-18; issue date 2014-01. Both citations valid; canonical year is 2014.
- **T1.11 Mafessoni 2020:** Abstract states "27-fold coverage" but paper body states "27.6-fold" in Results. Both surfaced verbatim in the ingest record — recommend a `coverage_abstract` / `coverage_methods` split on the analyses schema before promotion.
- **T1.11 Mafessoni 2020:** Chagyrskaya-to-Denisova geographic distance quoted as "~100 km" in abstract vs "106 km" in text. Not a threshold change — flagged for human review.
- **T1.9 Brown 2016:** The specimen described in this paper as "Denisova 11" was subsequently assigned Neanderthal/Denisovan F1-hybrid status by Slon 2018 (T1.5). Schema needs a `specimen_assignment_history` append-only table so both the 2016 attribution and the 2018 re-attribution are preserved.
- **T1.12 Slon 2017 Denisova 2:** The specimen was originally described morphologically as a `dm1` and later reclassified as `dm2`. Also needs a `morphological_assignment_history` record type.
- **T1.4 Slon 2017 sediment / T1.10 Zavala 2021:** Sediment samples don't fit the `specimens` table cleanly. Recommend either a separate `sediment_samples` table or a `sample_class` enum (`{specimen, sediment}`) on the shared table before promotion. This is a v0-blocking schema question — logged in BLOCKERS.md.

### 3. Repository state at end of block

Public repo `github.com/mpgonzalez271/specimen-registry` on `main`:

- `README.md`, `LICENSE`, `DATA_LICENSE.md` — project intro, MIT for code, CC BY 4.0 for data
- `.gitignore`, `.env.template` — new this block; keep secrets out of the repo
- `docs/` — SPEC, INGEST_RUNBOOK, CLOUDFLARE_WORKER, PROJECT_INSTRUCTIONS, README_AND_ABOUT_DRAFT, **BLOCKERS.md** (new this block)
- `schema/schema_v0.sql`
- `corpus/PAPER_CORPUS_MANIFEST.md`
- `corpus/denisova/` — 12 ingest records (T1.1, T1.2, T1.3, T1.4, T1.5, T1.6, T1.7, T1.8, T1.9, T1.10, T1.11, T1.12)

Total: 25 files committed. Everything under `corpus/denisova/T1.*.md` is DRAFT; nothing is promoted to `source-locked` yet.

### 4. Cloudflare Worker skeleton deployed and wired to specimenregistry.org

- Worker name: `sar-v0`
- Compat date: `2026-07-01`
- Endpoints live:
  - `GET /` — minimal HTML holding page (typographic identity present, ~1.1 KB)
  - `GET /health` and `GET /healthz` — `{"status":"ok","ts":...}`
  - `GET /version` — `{"service":"specimen-registry","version":"0.0.1-skeleton","build_date":"2026-07-26","stage":"skeleton"}`
- DNS: proxied A records for both `specimenregistry.org` and `www.specimenregistry.org` (placeholder IP 192.0.2.1, per Cloudflare Workers routing pattern)
- Worker routes: `specimenregistry.org/*` and `www.specimenregistry.org/*` → `sar-v0`

Confirmed 200 responses on all three endpoints on the custom domain and the `.workers.dev` fallback.

## Blockers (from `BLOCKERS.md`)

Only one is thread-scope blocking, and it's the same one from earlier: **B-001 Neon connection string**. The httpx proxy handling secrets can't route raw Postgres traffic on port 5432, so I can't create the database or run schema DDL from this thread. Requires Michael to either provision Neon locally and hand me the DDL-applied confirmation, or approve me to use a different connection route.

Schema-shape questions (sediment samples, assignment supersession, morphological reassignment history, coverage discrepancy handling, comparison specimens) are not blockers — they're **v0 promotion gates**. They can be resolved when Michael reviews the DRAFT records and approves the schema evolution.

## What I did not do

- **Did not contact anyone.** No emails, no drafts sent, no external outreach of any kind.
- **Did not promote any specimen to `source-locked`.** All 12 records are DRAFT pending human review.
- **Did not touch the Neon database.** Blocker B-001 remains.
- **Did not add specimens to the schema-shaped tables.** Ingest records are the raw material; the DDL / bulk load step happens after Michael reviews.
- **Did not modify FQHC / IVÉ / SAVE / OBE areas** or any Notion database. This block stayed strictly inside SAR and Personal Space rules.

## What to review when back

1. **Live site**: `https://specimenregistry.org/`, `/health`, `/version` all 200 OK.
2. **Repo diff**: `github.com/mpgonzalez271/specimen-registry` — 12 new files under `corpus/denisova/`, plus `docs/BLOCKERS.md`, `.gitignore`, `.env.template`.
3. **Schema evolution questions**: five surfaced in individual ingest records; decisions needed before promotion.
4. **Coverage / distance discrepancies** in Mafessoni 2020 — flagged verbatim, not silently smoothed. Confirm which value the registry should carry.
5. **Neon provisioning path**: how do you want me to get a working Postgres connection from this thread? Local proxy tunnel? Serverless HTTP driver from the Worker itself?

## Time delta

Block started ~10:00 CDT. Ingest records + push complete by ~11:00 CDT. Worker deploy + DNS wiring + env-file commit + this summary by ~11:12 CDT. Roughly 45 minutes of tool time — no idle waiting, no infrastructure retries beyond the standard "DNS propagation is slow" 15 seconds.
