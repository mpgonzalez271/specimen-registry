# Specimen Registry (SAR)

**Live API:** [https://specimenregistry.org](https://specimenregistry.org)
**Machine-readable spec:** [/openapi](https://specimenregistry.org/openapi)
**Current version:** `0.0.7-neon`
**Data license:** [CC BY 4.0](https://specimenregistry.org/license) — attribution required

A public, read-only registry of archaic hominin specimens (Neanderthals,
Denisovans, Sima de los Huesos hominins) plus select ancient anatomically
modern humans (Oase 1, Kostenki 14) — with every material claim
source-quoted verbatim from the primary literature.

This is a **personal side-project maintained by Michael Gonzalez with
AI-assisted ingest.** Every row carries a `verification_state`:

- `draft` — auto-parsed from an ingest markdown file; not yet reviewed
- `pending-verification` — imported from a paper Michael has staged
  for review but hasn't personally cross-checked against the PDF
- `source-locked` — Michael has verified the byline, abstract quote,
  and specimen claims against the primary source

**Only `source-locked` rows should be treated as ready to cite.** Until
each specimen is source-locked, treat this like a personal reading
notebook, not a peer-reviewed database.

---

## What's in it (as of 2026-07-26)

- **24** publications (10.1038/, 10.1073/, 10.1126/, 10.1016/, 10.1038/srep DOIs)
- **27** specimens across **13** sites (Denisova Cave, Vindija, Sima de los
  Huesos, Baishiya Karst, Chagyrskaya, Goyet, Hohlenstein-Stadel, Les Cottés,
  Mezmaiskaya, Oase, Scladina, Spy, Kostenki-Markina Gora)
- **24** analyses linking specimens to methods and papers
- **5** cross-specimen comparison rows (all `pending-verification`)
- Full-text search over publication titles/abstracts and specimen fields

---

## Quickstart

```bash
# Corpus totals + rollups
curl https://specimenregistry.org/stats

# Timeline of specimens by earliest describing publication
curl https://specimenregistry.org/timeline

# Full-text search
curl "https://specimenregistry.org/search?q=Denisovan&type=all"

# Single specimen
curl https://specimenregistry.org/specimens/denisova-3

# Provenance chain (papers -> site -> related specimens)
curl https://specimenregistry.org/graph/denisova-3

# All comparisons involving Vindija 33.16
curl "https://specimenregistry.org/comparisons?specimen_id=vindija-33-16"

# Machine-readable API spec
curl https://specimenregistry.org/openapi
```

All JSON responses carry a `citation` field with the required
CC BY 4.0 attribution string. Please use it.

---

## Endpoint index

| Path | Description |
|---|---|
| `/health` | Liveness probe |
| `/version` | Service version + capability set |
| `/license` | CC BY 4.0 attribution + citation string |
| `/stats` | Totals + specimens by verification state + specimens by site + publications by year |
| `/timeline` | Specimens with their earliest describing publication, ordered by year |
| `/audit` | Recent access-log entries (last N=20, IPs one-way hashed) |
| `/publications` | Paginated publication list |
| `/publications/{doi}` | Single publication (JSON or HTML) |
| `/specimens` | Paginated specimen list |
| `/specimens/{id}` | Single specimen (JSON or HTML) |
| `/sites` | List sites |
| `/sites/{id}` | Single site (JSON or HTML) |
| `/analyses` | Filter by `specimen_id` or `publication_id` |
| `/comparisons` | Cross-specimen relatedness rows |
| `/graph/{specimen_id}` | Provenance graph nodes + edges |
| `/search?q=…` | Full-text search over publications + specimens |
| `/openapi` | OpenAPI 3.1 spec |
| `/robots.txt`, `/sitemap.txt` | SEO scaffolding |

---

## Architecture

- **Runtime:** Cloudflare Workers (single global Worker at `specimenregistry.org`)
- **Data store:** Neon Postgres (serverless), accessed via `@neondatabase/serverless`
- **Ingest source of truth:** markdown files under `corpus/` and `02_denisova_pilot/paper_ingest/`
- **CI/CD:**
  - `.github/workflows/ingest-lint.yml` — lints every markdown ingest file on PR/push
  - `.github/workflows/deploy-worker.yml` — deploys Worker on push to `main` via wrangler

Rows are inserted from markdown ingest files by `tools/migrate_markdown_to_pg.py`.
The parser preserves human review state — once a row is promoted to
`source-locked`, subsequent re-ingest of the same file will NOT overwrite
substantive fields (only metadata like updated_at).

---

## Repo layout

```
├── worker/            # Cloudflare Worker (routes + HTML pages)
├── tools/             # ingest_lint.py, migrate_markdown_to_pg.py, seed_comparisons_v0.sql
├── 02_denisova_pilot/paper_ingest/   # Tier-1 Denisova corpus (primary scan dir)
├── corpus/
│   ├── denisova/              # Tier-1 duplicates + extras
│   ├── vindija/               # T2.6 Green 2010, T2.3 Prüfer 2017
│   ├── sima/                  # T2.1 Meyer 2016, T2.4 Meyer 2014
│   ├── oase/                  # T2.7 Fu 2015
│   ├── multi_site/            # T2.2 Hajdinjak 2018, T2.5 Peyrégne 2019
│   └── present_day_humans/    # Tier-3+ population studies + Kostenki 14
├── schema/            # SQL DDL and migrations
├── .github/workflows/ # ingest-lint.yml, deploy-worker.yml
├── CHANGELOG.md       # release notes
└── README.md
```

---

## Contributing / disagreements

This is a personal registry, not a peer-reviewed database. If you spot:

- A verbatim quote that doesn't match the paper
- A specimen with an incorrect site, catalog number, or method
- A cross-specimen comparison that's overstated

please open a GitHub issue with the DOI and the exact text you're
disputing. Michael reviews every issue before promoting anything to
`source-locked`.

---

## Contact & credit

Maintained by **Michael Gonzalez** with AI-assisted ingest.
Not affiliated with any research institution, museum, or excavation team.
For attribution use the string returned by [`/license`](https://specimenregistry.org/license).

Source: [github.com/mpgonzalez271/specimen-registry](https://github.com/mpgonzalez271/specimen-registry)
