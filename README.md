# Specimen Registry

A source-locked registry of published Late Pleistocene hominin specimens.

**Live site:** https://specimenregistry.org (pending v0.1 launch)
**License (code):** MIT
**License (data):** CC BY 4.0
**Status:** v0.1 — pilot corpus, Denisova Cave, Russia

---

## What this is

The Specimen Registry (SAR) is a public, machine-readable, source-locked catalog of published Late Pleistocene hominin specimens — the fossils and bone fragments that have been described in peer-reviewed literature between roughly 300,000 and 12,000 years before present.

Every record in the Registry traces to at least one peer-reviewed publication. Every material claim (specimen identity, taxonomic assignment, stratigraphic context, analytical result) has a verbatim quoted passage from the source publication attached. Every publication's authorship byline has been verified against Crossref.

The Registry is read-only. Data is ingested via a controlled pipeline documented in [`docs/INGEST_RUNBOOK.md`](docs/INGEST_RUNBOOK.md). The web interface is a display layer — not a submission portal or collaborative editing environment.

---

## AI-assistance disclosure

**Every SAR record has been produced with AI assistance.** Large language models were used to fetch, extract, and structure information from primary sources. Human review — by the maintainer, currently Michael Gonzalez — is required before any record is promoted to `source-locked` status.

Why this matters: LLM extraction of citation metadata has known failure modes, including byline fabrication and DOI misgeneration. The six-step ingest runbook in [`docs/INGEST_RUNBOOK.md`](docs/INGEST_RUNBOOK.md) is specifically designed to make those failure modes detectable and correctable. Every ingest session is logged; every source-locked record has a verifiable chain from the underlying paper's URL.

If you find an error in SAR data, please open a GitHub issue with the specific specimen ID, publication DOI, and the source-locked quote you believe is wrong. Corrections are welcomed and expected.

---

## Repository layout

- `README.md` — this file
- `LICENSE` — MIT license for code
- `DATA_LICENSE.md` — CC BY 4.0 license for data records
- `docs/`
  - `SPEC.md` — v0 technical specification
  - `INGEST_RUNBOOK.md` — six-step ingest discipline
  - `CLOUDFLARE_WORKER.md` — Worker + Neon architecture
  - `PROJECT_INSTRUCTIONS.md` — permanent operating rules
  - `README_AND_ABOUT_DRAFT.md` — public site copy (rendered by Worker)
- `schema/`
  - `schema_v0.sql` — Postgres DDL for the Registry
- `corpus/`
  - `PAPER_CORPUS_MANIFEST.md` — tier-1 and tier-2 paper catalog
  - `denisova/` — per-paper ingest records for the Denisova Cave pilot

---

## What this is not

- Not a replacement for peer-reviewed publication. SAR indexes what has been published; it does not adjudicate contested claims.
- Not a museum accession database. SAR references catalog numbers but does not house physical or 3D-model material.
- Not affiliated with any research institution, museum, or governmental body. Independent and volunteer-maintained.
- Not a place to report new findings or upload data. SAR follows the literature; it does not lead it.

---

## Contributing

**v0 is not accepting contributions to specimen data.** Data ingest is centralized during the pilot phase to establish workflow discipline.

**Code contributions are welcomed.** See `CONTRIBUTING.md` (to be added at launch).

**Specialist review is actively sought.** If you are a working specialist in Late Pleistocene hominin archaeology, paleogenomics, or a related field, and would like to review specific records or the methodology as a whole, please open a GitHub issue.

---

## Citation

If you use SAR data in your work:

```
Specimen Registry v0.1 (2026). Maintained by Michael Gonzalez with AI assistance.
Available at https://specimenregistry.org.
Accessed <date>.
```

For a specific specimen or publication record, cite the underlying peer-reviewed publication first; cite SAR only as a secondary reference indicating how the record was accessed.

---

Made with humility, source-lock discipline, and respect for the specialists whose work makes this possible.
