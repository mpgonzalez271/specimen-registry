# SAR Ingest Runbook v0

**Purpose:** Enforce the source-lock discipline for every paper ingested into SAR. This runbook is derived from the CHEE sprint incident of July 2026, in which LLM extraction of citation metadata produced fabricated DOIs and misattributed authorships. **Every step below exists to make that specific failure mode impossible.**

---

## The Six-Step Ingest Discipline

**No paper enters SAR without completing all six steps. No exceptions.**

### Step 1 — Primary-source fetch

- Fetch the paper from the publisher's canonical URL (nature.com, science.org, cell.com, pnas.org, pubmed.ncbi.nlm.nih.gov, arxiv.org, biorxiv.org).
- **Do NOT** fetch from a review paper, a Wikipedia citation, a database mirror, or an aggregator (ResearchGate, Academia.edu). Those are secondary sources and can silently be wrong.
- If the publisher URL is paywalled, fetch from the equivalent PMC deposit (`pmc.ncbi.nlm.nih.gov`) or the author's institutional repository. Otherwise flag `access-restricted` and hold.

### Step 2 — Metadata via Crossref (byline authority)

- Query Crossref by DOI: `https://api.crossref.org/works/<DOI>`.
- Extract author list from the Crossref record. **Crossref is authoritative for byline; publisher landing pages are NOT.**
- Cross-check journal, volume, issue, pages, publication date against both Crossref and the publisher landing page. If they disagree, publisher landing page wins for the actual issue.
- **Failure mode this catches:** LLM extractors have been observed inventing plausible author names or reordering the byline. Crossref's structured author field is the ground truth. This is a hard-learned lesson.

### Step 3 — Verbatim passage capture

- For every claim being ingested into a SAR record (specimen ID, taxonomic assignment, chamber/layer, catalog number, analysis method, result value), capture the exact quoted passage from the paper.
- Passages go in `verification_notes` (for publications) and in the specific field's `_source_quote` sidecar column (for specimens/analyses).
- **Every quoted passage includes the page number when available.** For open-access HTML papers where page numbers are ambiguous, include a section reference (e.g. "Methods §2.3").
- **Failure mode this catches:** paraphrased claims drift from the source and become fabrications over time. Verbatim quotes make drift auditable.

### Step 4 — Supplementary Information sweep

- Every paper's SI PDF must be fetched and quickly scanned for:
  - Specimen catalog numbers (typically in a "Materials" or "Specimens" appendix)
  - Museum accession information
  - Detailed stratigraphic context
  - Radiocarbon/OSL sample IDs and dates in tables
- Catalog numbers rarely appear in main-text abstracts. **If catalog number is missing from ingest, SI has not been consulted.**
- SI is often more forensically valuable than the main paper. Don't skip it.

### Step 5 — Cross-reference to prior corpus

- For every specimen mentioned, check if that specimen already has a SAR record.
- If yes: add a new analysis row against the existing specimen; DO NOT create a duplicate specimen record.
- If no: create a new specimen record with the earliest paper as the `provenance_publication`.
- For every dating update, radiocarbon revision, or morphological reinterpretation, add a new analysis row rather than overwriting existing rows. SAR is append-only for the historical record.
- **Failure mode this catches:** creating duplicate specimen records (Denisova 3 vs. "the finger bone from layer 11") through inconsistent naming.

### Step 6 — Verification checklist before promotion

A paper's `verification_status` cannot advance from `pending-verification` to `source-locked` until:

- [ ] Byline verified against Crossref
- [ ] DOI resolves to the correct paper (fetch the DOI URL, verify title matches)
- [ ] All specimen names cross-checked against prior SAR corpus
- [ ] All quoted passages present in the source (spot-check by Michael or a designated reviewer for the first 20 papers; sampled thereafter)
- [ ] SI extracted for catalog numbers and specimen tables
- [ ] Data availability accessions captured (ENA, GenBank, PANGAEA, etc.)
- [ ] No LLM-only claims — every field traces to a fetched primary passage

**Michael must personally review the first 20 papers' verification packages** before the workflow is trusted to scale. After 20, sample every 5th paper.

---

## Hard Rules — the CHEE-lessons codified

These rules are **non-negotiable** and encoded into the ingest workflow at the tool level where possible.

### Hard Rule 1 — No citations from memory

The LLM never generates a citation, DOI, or author name from its training data. Every citation is **fetched from Crossref or the publisher landing page** for the specific paper being ingested.

If the LLM produces a citation without a corresponding recent Crossref fetch in the audit log, **the ingest is rejected.** This is the specific rule that would have caught the July 2026 Antoine-Derouet 2026 fabrication (DOI prefix 10.64898 not matching bioRxiv's 10.1101 prefix).

### Hard Rule 2 — Verify byline against Crossref every time

Publisher landing pages truncate bylines to "Author, A., Author, B. *et al.*" without warning. Crossref preserves the full ordered list. **Bylines come from Crossref, always.**

### Hard Rule 3 — Extractor output is a draft, not a source

LLM-extracted tables are drafts that require human review. The extractor is a first-pass reader, not an authority. **Any field where the extractor's output is used without human cross-check is flagged in `verification_notes` as `extractor-only-review`** and cannot be promoted to `source-locked` until reviewed.

### Hard Rule 4 — Cross-check specimen names against existing SAR records

If a paper mentions "Denisova 11" and SAR already has a Denisova 11 record, the new paper's analyses link to that record — do not create a duplicate. This requires a deterministic specimen-name normalizer in the ingest pipeline.

### Hard Rule 5 — Every taxonomic assignment has a source-locked quote

Taxonomic assignments (Denisovan / Neanderthal / hybrid / unassigned) are the most-questioned SAR data. Every specimen's assignment must have the exact paper passage quoted in the specimen's `notes` field.

### Hard Rule 6 — No inference to SAR without a flag

If a chamber attribution, layer, or catalog number is inferred from community knowledge but not source-locked to a paper, the field either:
- Stays null, OR
- Is populated with an explicit `[inferred-from-community]` tag

**Never launder community-standard inferences as if they were source-locked.** This is exactly how errors propagate through review literature.

---

## Ingest audit log

Every ingest session records:

- Timestamp
- Ingester (Michael, or which LLM if AI-assisted)
- Papers ingested
- URLs fetched (with timestamps)
- Crossref queries made
- Fields flagged for human review
- Papers promoted to `source-locked`

Audit log lives in `/home/user/workspace/sar/06_audit_log/YYYY-MM-DD.md` (v0) and moves to a database table in v0.2.

---

## What to do when a paper contradicts prior SAR data

Sometimes a new paper updates a specimen's assignment, refines a date, or reinterprets stratigraphy. **SAR does not delete or overwrite the prior record.** Instead:

1. Add a new analysis row with the new result.
2. Update the specimen's `taxonomic_assignment` (or `stratigraphic_context`) only if the community has accepted the update — otherwise keep the historical value and let the two analysis rows tell the story.
3. If community consensus is unclear, keep the older assignment as canonical and add a `disputed_assignment` note pointing to the new paper.

**SAR shows what published papers say. It does not adjudicate.**

---

## What to do when the ingester is wrong

The July 2026 Douka 2019 ingest produced a garbled byline ("B. L. L. Demeter" — impossible, Demeter is Cobra Cave / MNHN, not a Douka 2019 co-author). This is the exact class of failure we're protecting against.

If you notice extractor error during ingest:
1. Log the specific failure mode in the audit log.
2. Reconstruct the correct data from Crossref.
3. Add the failure pattern to `KNOWN_EXTRACTOR_FAILURES.md` for future ingests to be alert for.
4. Do NOT trust the extractor's output for that field in future ingests without additional verification.

---

## The rule of thumb

**If you cannot point to a specific URL you fetched today and a specific quoted passage on that page, the claim doesn't go in SAR.**

This one rule replaces most of the rest.
