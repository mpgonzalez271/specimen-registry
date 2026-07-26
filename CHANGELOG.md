# Changelog

All notable changes to the Specimen Registry (SAR) are documented here. The
project follows a rough SemVer scheme: `0.<minor>.<patch>-neon`.

The registry is a personal side-project maintained by Michael Gonzalez with
AI-assisted ingest. Every row is either `draft`, `pending-verification`, or
`source-locked`; only source-locked rows should be treated as ready for
citation. All draft rows require Michael's manual review of the primary
source before promotion.

Data license: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See
[/license](https://specimenregistry.org/license) for the runtime citation
string.

---

## [0.0.5-neon] — 2026-07-26

### Added
- **Tier-3 corpus (3 papers):**
  - T3.1 Sawyer et al. 2015 (PNAS, 10.1073/pnas.1519905112) — introduces
    Denisova 4 nuclear DNA + Denisova 8 mtDNA/nuclear DNA.
  - T3.2 Reich et al. 2011 (AJHG, 10.1016/j.ajhg.2011.09.005) — population-
    level Denisovan admixture survey across 33 SEA/Oceania populations.
  - T3.3 Sankararaman et al. 2014 (Nature, 10.1038/nature12961) — population-
    level Neanderthal-ancestry haplotype map across 1,004 present-day humans.
- **Tier-2 corpus (5 papers):**
  - T2.2 Hajdinjak et al. 2018 (Nature, 10.1038/nature26151) — five late
    Neanderthals (Goyet Q56-1, Spy 94a, Les Cottés Z4-1514, Vindija 87,
    Mezmaiskaya 2).
  - T2.4 Meyer et al. 2014 (Nature, 10.1038/nature12788) — Sima de los Huesos
    Femur XIII mtDNA.
  - T2.5 Peyrégne et al. 2019 (Sci Adv, 10.1126/sciadv.aaw5873) —
    Hohlenstein-Stadel + Scladina I-4A early Neanderthals.
  - T2.6 Green et al. 2010 (Science, 10.1126/science.1188021) — draft
    Neanderthal genome (Vi33.16, Vi33.25, Vi33.26).
  - T2.7 Fu et al. 2015 (Nature, 10.1038/nature14558) — Oase 1 mandible.
- **New endpoints:** `/license`, `/comparisons`, `/comparisons/:id`,
  `/graph/:specimen_id`.
- **Interactive HTML pages** for `/specimens/:id`, `/publications/:id`,
  `/sites/:id`, and `/search`.
- **`specimen_comparisons` schema + seed:** 5 initial cross-specimen
  relatedness rows (all `pending-verification`) from Tier-2 papers.
- **Citation field** on every JSON response.
- **Soft in-memory rate limit** with Neon `access_log` writes via
  `ctx.waitUntil`.
- **CI/CD:** GitHub Actions workflow deploys Worker on every push to `main`;
  ingest-linter workflow validates every ingest markdown change.

### Changed
- Parser (`tools/migrate_markdown_to_pg.py`) scans additional corpus
  subdirectories: `vindija/`, `sima/`, `oase/`, `multi_site/`,
  `present_day_humans/`, `late_neanderthals/`, `early_neanderthals/`
  (missing dirs silently skipped).
- Linter (`tools/ingest_lint.py`) walks the whole corpus tree recursively,
  skipping `node_modules/.git/dist/__pycache__`.

### Fixed
- Parser now correctly de-duplicates ingest files by resolved absolute path
  when the same file appears under multiple scan roots.
- Parser skips upsert of `pending-verification` and `source-locked` rows on
  fields other than metadata, preserving human review state.

### Neon state (2026-07-26)
- Publications: 22
- Specimens: 26
- Sites: 12
- Analyses: 22 (Tier-1 + Tier-2 + Tier-3)
- Specimen comparisons: 5 (all pending-verification)

---

## [0.0.4-neon] — 2026-07-26

### Added
- Full-text search on publications/specimens.
- Pagination on list endpoints (`limit`, `offset`, `next_offset`).
- Tier-2 pilot ingest (Meyer 2016 Sima nDNA, Prüfer 2017 Vindija).
- Editorial pass 02: verbatim abstract quotes on Tier-1 papers.
- GitHub Actions deploy pipeline (Cloudflare Workers via wrangler).

### Fixed
- Worker responses now include stable JSON envelope on error paths.

---

## [0.0.3-neon] — earlier

Migration to Neon Postgres from local SQLite. Initial CI/CD scaffolding.

---

## [0.0.2-neon] — earlier

Initial Tier-1 Denisova Cave pilot corpus (12 papers).

---

## [0.0.1] — earlier

Bootstrap: schema, parser, worker skeleton, private Cloudflare zone.
