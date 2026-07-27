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

## [0.0.11-neon] — 2026-07-27 (block #8)

### Added
- `/sitemap.xml` — proper XML sitemap enumerating static routes plus every specimen, site, and publication URL. `/robots.txt` updated to reference both `sitemap.xml` and `sitemap.txt`.
- Year filter on `/publications` — `?year=YYYY` or `?year_min=YYYY&year_max=YYYY`.
- HTML rendering for `/specimens` and `/publications` list views (previously JSON-only). Tables with verification-state chips, per-row links, and CSV download links.
- Two Tier-5 corpus entries:
  - T5.5 Krings 1997 (10.1016/s0092-8674(00)80310-4) — the *first ever* Neanderthal DNA sequence (Feldhofer type specimen). Adds `feldhofer-1` specimen + `feldhofer-cave` site.
  - T5.6 Fu 2015 (10.1038/nature14558) — Oase 1 nuclear genome; the 6–9% Neanderthal ancestry / 4–6-generations-back finding.
- New comparison row: Mezmaiskaya 1 ↔ Feldhofer 1 mtDNA (3.48% divergence claim from Ovchinnikov 2000). First-ever pairwise Neanderthal mtDNA comparison in the corpus.

### Corpus totals (end of block #8)
- Publications: **28** (added Krings 1997, Fu 2015)
- Specimens: **31** (added `feldhofer-1`)
- Sites: **15** (added `feldhofer-cave`)
- Analyses: **31** (added Krings mtDNA + Fu 2015 nuclear)
- Comparisons: **36** (up from 35)

---

## [0.0.10-neon] — 2026-07-27 (block #7)

### Added
- HTML rendering for `/methods` and `/audit` (previously JSON-only). Both routes now render tables when `Accept: text/html` is requested; JSON contract unchanged for programmatic clients.
- Two Tier-5 corpus entries:
  - T5.3 Ovchinnikov 2000 (10.1038/35006625) — first-describing mtDNA paper for Mezmaiskaya 1; closes a comparator gap referenced by Hajdinjak 2018.
  - T5.4 Prüfer 2014 (10.1038/nature12886) — originating publication for the Denisova 5 (Altai) high-coverage Neanderthal genome; previously present as a specimen but cross-referenced only.
- New specimen: `mezmaiskaya-1` (Caucasus Neanderthal infant).
- 5 retroactive `specimen_comparisons` rows linking the five late Neanderthals in Hajdinjak 2018 to Mezmaiskaya 1 for the population-turnover claim.
- 2 new `analyses` rows for Prüfer 2014 (denisova-5 high-coverage + mezmaiskaya-1 low-coverage; the second is pending disambiguation from Mezmaiskaya 2).

### Fixed
- HTML `/methods` render bug: pg's `array_agg` returns a text-literal (`{a,b}`) not a JS array over the Neon serverless driver; added `parseArr()` helper.

---

## [0.0.9-neon] — 2026-07-27 (block #7)

### Added
- `/related/{id}` — neighbor specimens across three relatedness surfaces (shared publication, same site, `specimen_comparisons` row).
- `/export.csv?table={publications|specimens|analyses|comparisons}` — bulk CSV export with `content-disposition: attachment` and `x-sar-row-count` header. Default: specimens.
- OpenAPI spec entries for both new routes.

---

## [0.0.8-neon] — 2026-07-27

### Added
- `/methods` endpoint listing distinct `specimens.assignment_method` and `analyses.method` values with counts.
- HTML rendering for `/stats` and `/timeline` (previously JSON-only).
- Two Tier-5 corpus entries:
  - T5.1 Kuhlwilm 2016 (10.1038/nature16544) — early modern human → Altai Neanderthal gene flow ~100 kya.
  - T5.2 Rougier 2007 (10.1073/pnas.0610538104) — Oase 2 cranial morphology (companion to Fu 2015).
- 25 new `specimen_comparisons` rows auto-generated from Hajdinjak 2018 verbatim PubMed abstract, covering pairwise relatedness among the five late Neanderthals plus their relationships to Vindija 33.19, Denisova 5, and Oase 1.
- Hajdinjak 2018 abstract promoted from `pending-verification` to source-locked (verified verbatim against PubMed PMID 29562232).

### Fixed
- `/openapi` route: `.json` extension was being stripped by the content-type normalizer causing `/openapi.json` to 404. Now handles both `/openapi` and `/openapi.json`.
- `/audit` query used non-existent `access_log.user_agent` column; corrected to `access_log.ua AS user_agent`.
- `/methods` initial deploy queried non-existent `analyses.analysis_type`; corrected to `analyses.method`.

### Corpus totals (end of block #6)
- Publications: **26**
- Specimens: **29** (added `sidron-cr21`, `oase-2`)
- Sites: **14** (added `el-sidron-cave`)
- Analyses: **26**
- Comparisons: **30** (up from 5)

### Corpus totals (end of block #7)
- Publications: **27** (added Ovchinnikov 2000, Prüfer 2014)
- Specimens: **30** (added `mezmaiskaya-1`)
- Sites: **14**
- Analyses: **29** (added Ovchinnikov mtDNA + two Prüfer 2014 rows)
- Comparisons: **35** (up from 30 with Mezmaiskaya 1 comparator rows)

---

## [0.0.7-neon] — 2026-07-26

### Added
- `/timeline` — specimens ordered by earliest describing publication year.
- `/audit` — recent access-log entries; IPs one-way hashed; limit 1–100 (default 20).
- `/openapi` and `/openapi.json` — full OpenAPI 3.1 spec with all documented routes.
- README.md refreshed with quickstart, endpoint index, contributing/disagreement policy, and repo layout.

---

## [0.0.6-neon] — 2026-07-26

### Added
- `/stats` endpoint (totals + specimens by verification state + specimens by site + publications by year).
- Tier-3 and Tier-4 corpus entries:
  - T3.1 Sawyer 2015 (Denisova 4 + Denisova 8).
  - T3.2 Reich 2011 (Denisovan admixture population survey).
  - T3.3 Sankararaman 2014 (Neanderthal-ancestry haplotype map).
  - T4.1 Vernot & Akey 2014 (Neanderthal introgression map).
  - T4.2 Seguin-Orlando 2014 (Kostenki 14 Upper Paleolithic modern-human genome). New site `kostenki-markina-gora`.

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
