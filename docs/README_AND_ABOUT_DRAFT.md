# SAR — Public README and About Page Copy (Draft v0)

Both artifacts follow the same tone: **plainspoken, humble, transparent about AI assistance, oriented toward specialists, not general audiences.**

---

## GitHub Repository README

```markdown
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

The Registry is read-only. Data is ingested via a controlled pipeline documented in `INGEST_RUNBOOK_v0.md`. The web interface is a display layer — not a submission portal or collaborative editing environment.

---

## What this is not

- Not a replacement for peer-reviewed publication. SAR indexes what has been published; it does not adjudicate contested claims.
- Not a museum accession database. SAR references catalog numbers but does not house physical or 3D-model material.
- Not affiliated with any research institution, museum, or governmental body. Independent and volunteer-maintained.
- Not a place to report new findings or upload data. SAR follows the literature; it does not lead it.

---

## Methodology

Every specimen record must satisfy the six-step ingest discipline documented in `INGEST_RUNBOOK_v0.md`:

1. Primary-source fetch from the publisher's canonical URL
2. Byline verification against Crossref
3. Verbatim quote capture for every material claim
4. Supplementary Information sweep for catalog numbers and specimen tables
5. Cross-reference to prior corpus (no duplicate specimen records)
6. Human verification review before promotion to `source-locked` status

Data model, schema, and ingest workflow are all in this repository — the pipeline is auditable end-to-end.

---

## AI-assistance disclosure

**Every SAR record has been produced with AI assistance.** Large language models were used to fetch, extract, and structure information from primary sources. Human review — by the maintainer, currently Michael Gonzalez — is required before any record is promoted to `source-locked` status.

Why this matters: LLM extraction of citation metadata has known failure modes, including byline fabrication and DOI misgeneration. The six-step ingest runbook is specifically designed to make those failure modes detectable and correctable. Every ingest session is logged; every source-locked record has a verifiable chain from the underlying paper's URL.

If you find an error in SAR data, please open a GitHub issue with the specific specimen ID, publication DOI, and the source-locked quote you believe is wrong. Corrections are welcomed and expected.

---

## Contributing

**v0 is not accepting contributions to specimen data.** Data ingest is centralized during the pilot phase to establish workflow discipline.

**Code contributions are welcomed.** See `CONTRIBUTING.md` (to be added at launch).

**Specialist review is actively sought.** If you are a working specialist in Late Pleistocene hominin archaeology, paleogenomics, or a related field, and would like to review specific records or the methodology as a whole, please contact the maintainer via GitHub.

---

## Contact

- GitHub: https://github.com/specimen-registry (issues, code review, methodology comments)
- Email: (contact details TBD before public launch)

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

## Roadmap

- **v0.1 (target: 8 weeks from repository creation):** Denisova Cave pilot corpus, 12+ tier-1 publications, ~20+ specimens.
- **v0.2 (target: +8 weeks):** Add Sima de los Huesos, Chagyrskaya, Vindija corpora.
- **v0.3:** Data-availability accession index; expanded FTS with quote-level search.
- **v1.0:** Multi-site coverage across the major Late Pleistocene European and Asian sites.

---

Made with humility, source-lock discipline, and respect for the specialists whose work makes this possible.
```

---

## Public /about page copy (rendered by Cloudflare Worker)

```markdown
# About the Specimen Registry

## Origin

The Specimen Registry was started in 2026 as a personal project by Michael Gonzalez, a compliance operator working in an unrelated field (US healthcare regulation). It arose from an outside-the-field interest in Late Pleistocene archaeology and paleogenomics.

The Registry exists because the field's literature is scattered across dozens of journals with inconsistent naming, incomplete cross-referencing, and specimen records that sometimes only appear in supplementary information. A source-locked, structured index — where every claim traces to a fetched primary passage — is useful infrastructure. Building it does not require original scientific work; it requires patience, discipline, and honesty about what has and has not been verified.

## Methodology in plain language

For every peer-reviewed paper indexed by the Registry, we do six things:

1. **Fetch the paper.** We open the publisher's original page, not a review, not a Wikipedia link, not a mirror.
2. **Verify the byline.** We check every author's name and order against Crossref, the DOI registry. LLM extraction of author lists has been observed to introduce errors; Crossref is the ground truth.
3. **Quote the source.** Every material claim in the Registry — a specimen's taxonomic identity, its stratigraphic context, its catalog number, its analytical results — has a verbatim quoted passage from the paper attached. If a claim can't be quoted, it isn't added.
4. **Read the supplementary information.** Catalog numbers and specimen tables usually live in SI, not the main text. We pull the SI PDF for every paper.
5. **Cross-reference the corpus.** A new paper mentioning "Denisova 11" gets its analyses attached to the existing Denisova 11 record. We do not create duplicate records.
6. **Human review.** Every record is reviewed by the maintainer before it enters the public "source-locked" state. The first 20 papers are reviewed exhaustively; subsequent papers are sampled at 20%.

## AI-assistance disclosure

**Every record in the Registry has been produced with AI assistance.** Large language models are used to fetch documents, extract passages, and structure data into the schema. This is disclosed prominently because:

- LLM extraction has known failure modes (byline fabrication, misattributed quotes, invented DOIs).
- The Registry's value depends on trust in its data, and trust in AI-assisted data requires transparency.
- Users of the Registry should verify critical claims against the primary sources, which are linked from every record.

The six-step ingest workflow is designed specifically to make LLM failure modes detectable and correctable. Verification is a human responsibility; the ingest pipeline is documented in the public repository.

## What the Registry does not do

- **Does not adjudicate contested claims.** If a specimen's assignment is disputed in the literature, we document the dispute and cite both positions. We do not pick a winner.
- **Does not host copyrighted material.** No specimen photographs, no PDFs of papers, no 3D models. Only text records, structured metadata, and links.
- **Does not accept public submissions.** Data ingest is centralized. Corrections, methodology comments, and technical improvements are welcomed via GitHub issues.
- **Does not claim novelty.** The Registry does not identify gaps in the literature, propose new interpretations, or make scientific claims. It is an index of what has been published.

## Independence and non-affiliation

The Specimen Registry is not affiliated with any research institution, museum, funding body, or government agency. It is maintained by one individual with AI assistance. The maintainer has no formal training in archaeology, paleogenomics, or related fields. This is stated plainly because it is relevant to how the Registry should be used.

## How to cite

If you use SAR data in your work, please cite the underlying peer-reviewed publication first. Cite the Registry only as a secondary reference indicating how the record was accessed:

> Specimen Registry v0.1 (2026). Maintained by Michael Gonzalez with AI assistance. Available at https://specimenregistry.org, accessed [date].

## Corrections and contact

If you find an error, please open a GitHub issue at https://github.com/specimen-registry with:

- The specimen ID or publication DOI in question
- The source-locked quote you believe is incorrect
- The correction, with a link to the primary source supporting it

The maintainer responds within seven days. Corrections are logged publicly and credited to the reporter.

For methodology discussion, alpha-review invitations, or collaboration proposals, contact the maintainer through GitHub or via email (address TBD before public launch).

---

**Last updated:** [date of deploy]
**Registry version:** v0.1
**Corpus scope:** Denisova Cave (v0.1 pilot); further sites in roadmap
**License:** Code MIT, data CC BY 4.0
```
