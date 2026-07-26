# SAR v0 — Specimen and Analysis Registry — Technical Spec

**Status:** Draft v0.1 — awaiting Michael's review
**Date:** 2026-07-26
**Author:** Michael Gonzalez (AI-assisted)
**Pilot site:** Denisova Cave, Altai Republic, Russia
**Target:** v0 (Denisova-only, read-only public) live within 6–8 weeks of build start

---

## 1. Problem statement

For any given archaeological / paleoanthropological site, published specimen-level data is scattered across 15–40 years of primary literature, museum accession registries, and lab databases. Specialists routinely need to answer questions like:

- Which specimens from Denisova Cave Layer 11 have had aDNA extraction attempted?
- Which unassigned bone fragments from Chamber East have had ZooMS applied?
- Where is specimen "Denisova 8" currently held, and what analyses have been published on it?

Today these questions require reading a review paper (out of date on publication) plus a dozen primary papers plus emails to specialists. There is no unified, source-locked, machine-queryable public record.

SAR v0 is the minimum viable version of that record for one site.

---

## 2. Explicit non-goals (v0)

Being clear about what SAR is NOT, because scope creep is the fastest way to kill an infrastructure project.

- **Not a raw-data repository.** SAR does NOT host DNA sequences, mass spectra, or radiocarbon dates themselves. It links to the published sources and repositories (ENA, PANGAEA, GenBank) where the primary data lives.
- **Not a peer-review or interpretation platform.** SAR does not editorialize, does not rank interpretations, does not flag "contested" claims. It records what published papers say and by whom.
- **Not a permit / provenance authority.** SAR records what published papers say about specimen origins. It does not adjudicate legality, ownership, or ethics.
- **Not an outreach tool.** SAR does not push notifications, send emails to specialists, or ask anyone for anything.
- **Not tied to FQHC 340B Compliance.** Separate domain, separate identity, separate infrastructure.

---

## 3. v0 scope (single pilot site)

**One site only: Denisova Cave.**

Justification for Denisova over other candidates:
- Highest published-paper density of any Middle/Upper Paleolithic hominin site (~40+ specimen-level primary papers 2010–2026).
- Widest range of analytical methods applied (aDNA, morphology, ZooMS/paleoproteomics, isotopes, direct dating, sediment DNA).
- Multiple hominin taxa present (Denisovan, Neanderthal, hybrid Denisova 11, modern human sediment DNA) — exercises the data model harder than a single-taxon site.
- No overlap with any Ship recipient's ongoing fieldwork. Welker's ZooMS work touched Denisova 8 (published, closed) but he is not the Cobra-style corresponding author on ongoing Denisova excavation.
- Ground truth: because so much is published, we can validate our extraction pipeline against known-correct facts.

**Coverage target for v0:**
- All named specimens with published morphological description, aDNA data, ZooMS assignment, or isotopic analysis (estimated 15–25 named + many more unassigned/screened fragments).
- All primary publications 2010–2026 that report specimen-level analyses (estimated ~35–50 papers).
- All named strata / chambers / layers referenced in published stratigraphy.

**Deferred to v1+:**
- Additional sites (target: 3–5 more in year 2).
- Write API / specialist self-service editing.
- PDF ingest automation (v0 = manual + LLM-assisted with human review; v1 = pipeline).
- Cross-site queries.

---

## 4. Data model (v0)

Four core tables. Deliberately simple; complexity earns its way in.

### 4.1 `sites`

| Column | Type | Notes |
|---|---|---|
| `id` | text (slug) | e.g. `denisova-cave` |
| `name` | text | "Denisova Cave" |
| `country` | text | "Russia" |
| `coordinates` | point | 51.3975°N, 84.6761°E |
| `custody_notes` | text (markdown) | Institute of Archaeology and Ethnography SB RAS (Novosibirsk) primary; MPI-EVA and others as noted per-specimen |
| `stratigraphy_summary` | text (markdown) | Chambers Main/East/South; layers 8–17 with key horizons |
| `created_at`, `updated_at` | timestamp | |

v0 will have one row. Table exists for v1+ multi-site expansion.

### 4.2 `specimens`

| Column | Type | Notes |
|---|---|---|
| `id` | text (slug) | e.g. `denisova-3`, `denisova-cave-du-172-cave-east-layer-11-fragment-42` |
| `site_id` | fk → sites | |
| `catalog_number` | text | Museum/institutional accession where known |
| `common_name` | text | "Denisova 3", "Denisova 11 (Denny)" — for named specimens only |
| `taxonomic_assignment` | text | Published assignment as of most recent paper; "Denisovan", "Neanderthal", "Homo sp.", "unassigned", "faunal" |
| `assignment_method` | text | "aDNA", "ZooMS", "morphology", "sediment DNA", "unassigned" |
| `assignment_publication` | fk → publications | Which paper published the assignment (or the most recent update to it) |
| `stratigraphic_context` | jsonb | `{chamber: "East", layer: "11", associated_dates: [...]}` |
| `material_type` | text | "bone fragment", "tooth", "phalanx", "sediment" |
| `current_custody` | text | "IAET SB RAS Novosibirsk" or "MPI-EVA Leipzig on loan" |
| `notes` | text (markdown) | Free-form with source-locked quotes |
| `created_at`, `updated_at` | timestamp | |

**Every specimen row must be traceable to at least one `assignment_publication`.** If a specimen appears in the literature but has no source-locked assignment quote, it goes in with `taxonomic_assignment = "unassigned"` and a `provenance_publication` pointer.

### 4.3 `analyses`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `specimen_id` | fk → specimens | |
| `method` | text (enum) | See §4.5 for the controlled vocabulary |
| `lab` | text | "MPI-EVA Leipzig", "Copenhagen paleoproteomics" |
| `publication_id` | fk → publications | The paper that reports this analysis |
| `analysis_date` | date | When the analysis was performed (from paper methods) |
| `result_summary` | text (markdown) | Short human-readable; must include a quoted passage from the paper |
| `result_data_link` | text (url) | Link to primary data if deposited (ENA accession, PANGAEA DOI, etc.) |
| `notes` | text (markdown) | |
| `created_at`, `updated_at` | timestamp | |

An analysis row = one method applied to one specimen and reported in one publication. If the same specimen has aDNA extracted three times by three different labs in three different papers, that's three analysis rows.

### 4.4 `publications`

| Column | Type | Notes |
|---|---|---|
| `id` | text (DOI or arXiv id) | `10.1038/s41586-024-07612-9` |
| `title` | text | |
| `authors` | text[] | Full byline in order, verbatim |
| `year` | int | |
| `journal` | text | |
| `volume_issue_pages` | text | |
| `abstract` | text | Verbatim from source |
| `open_access_url` | text | If available |
| `methods_applied` | text[] | Denormalized from analysis rows for search |
| `specimens_referenced` | text[] | Denormalized from analysis rows for search |
| `verification_status` | enum | `source-locked` / `pending-verification` / `flagged` |
| `verification_notes` | text | Who verified when, what quotes were checked |
| `created_at`, `updated_at` | timestamp | |

**Every publication row must have `verification_status = 'source-locked'` before it is visible on the public site.** No exceptions. This is the discipline the CHEE sprint identified as required. Unverified papers stay in a private staging table.

### 4.5 Controlled vocabulary for `method`

Enum values for v0 (extensible):
- `aDNA-nuclear`
- `aDNA-mitochondrial`
- `aDNA-sediment`
- `ZooMS` (peptide-mass-fingerprint species ID)
- `paleoproteomics-full` (full proteome, e.g. enamel or bone)
- `morphology-2D` (traditional morphometrics)
- `morphology-3D` (CT/µCT/geometric morphometrics)
- `isotope-C-N` (bulk δ¹³C / δ¹⁵N)
- `isotope-Sr` (⁸⁷Sr/⁸⁶Sr mobility)
- `isotope-O` (δ¹⁸O)
- `isotope-S` (δ³⁴S)
- `isotope-CSIA` (compound-specific)
- `radiocarbon-AMS` (direct or bulk)
- `U-series` (uranium-series)
- `OSL-TL` (luminescence dating)
- `ESR` (electron spin resonance)
- `sediment-micromorphology`
- `sediment-DNA-metagenomics`

If a v0 paper uses a method not on this list, we add it to the enum with a documented definition before ingesting the paper. No ad-hoc method names.

---

## 5. Tech stack

### 5.1 Recommended stack

- **Database:** Neon Postgres (serverless Postgres on AWS, generous free tier, upgrades cleanly).
  - Why NOT Cloudflare D1: D1's SQLite-based limits (10 GB per DB, single-writer, no full-text search without add-ons) will bite in year 2 when we add sites. Postgres from day 1 avoids a painful migration later.
  - Why Neon over Supabase: no auth/realtime/storage features we need in v0, so Neon's simpler pricing wins. Supabase is a reasonable alternative if we later want its dashboard.
- **Application:** Cloudflare Workers (edge runtime).
  - Hono framework (small, TypeScript, works well with Workers).
  - Server-rendered HTML + minimal client JS (no React SPA in v0 — the site is 90% content, 10% interaction).
- **Search:** Postgres full-text search for v0. Meilisearch or Typesense in v1 if search UX needs it.
- **Auth (v1, not v0):** Cloudflare Access + ORCID login for specialist edit accounts. v0 is read-only public with no auth.
- **CDN + edge:** Cloudflare (already Michael's platform of choice).
- **Domain:** `specimenregistry.org` if available; `specimenregistry.io` as backup. See §7.
- **Repo:** GitHub, public from day 1 under MIT license. Suggested repo name: `specimen-registry` under a new org (not under fqhc340b).
- **Deployments:** Cloudflare Wrangler + GitHub Actions.

### 5.2 Cost estimate (v0)

| Line item | Monthly | Notes |
|---|---|---|
| Neon Postgres (Launch plan) | $19/mo | Well under the free 512MB for v0 but Launch plan buys point-in-time recovery |
| Cloudflare Workers Paid | $5/mo | Free tier is enough but paid unlocks D1/durable objects for future features |
| Domain registration | ~$12/yr | via Cloudflare Registrar at cost |
| GitHub (public repo) | $0 | |
| **Total** | **~$25/mo + $12/yr** | v1 (with more sites, PDF pipeline) est. $50–100/mo |

Zero operating cost paid to any external party per analysis or per query.

---

## 6. Ingest workflow (v0)

Manual + LLM-assisted with mandatory human review.

For each of the ~35–50 papers in the v0 corpus:

1. **Fetch the PDF or open-access HTML** from the publisher / arXiv / bioRxiv / museum institutional repository.
2. **Extract metadata** (DOI, title, authors, year, journal, volume/issue/pages, abstract) — verified against the publisher landing page, not just from the PDF.
3. **Extract specimen references and analyses** — LLM-drafted, human-reviewed against the paper's Materials & Methods and Results sections.
4. **Source-lock verification:** for every claim ingested (specimen ID, taxonomic assignment, method, lab, result), record the exact quoted passage and page number from the paper. This lives in `analyses.notes` and `publications.verification_notes`.
5. **Cross-check the specimen against prior papers.** If Denisova 8 already has 4 published analyses, adding a 5th requires reconciling assignment updates.
6. **Human sign-off (Michael):** paper does not go from `pending-verification` → `source-locked` until Michael has personally reviewed the verification quotes for at least a sampled subset per paper.

**Estimated time per paper for v0:** 45–90 minutes with LLM assistance and disciplined verification. That's 30–75 hours total for the pilot corpus, spread across 6–8 weeks of evenings.

---

## 7. Domain and repo

### 7.1 Domain candidates

Checked 2026-07-26 via DNS resolution (best available signal in the sandbox; will re-check with whois before purchase):
- `specimenregistry.org` — NS lookup timed out (likely available; needs whois confirmation)
- `specimenregistry.io` — no NS records (likely available)
- `paleoregistry.org` — NS lookup timed out (likely available; needs whois confirmation)
- `paleoregistry.io` — no NS records (likely available)
- `sarproject.org` — TAKEN (Wix site)
- `openspecimen.org` — TAKEN (Krishagni clinical biobank platform, big project, avoid)

**Recommendation:** register `specimenregistry.org` if available. `.org` reads as nonprofit-infrastructure, which is the positioning we want. Fallback: `specimenregistry.io`.

**Domain purchase is A-tier (financial + external commitment) → requires Michael's explicit confirm_action before I register anything.** Do NOT purchase without approval.

### 7.2 GitHub org

Recommended new GitHub org name: `specimen-registry` (matches domain). Repo: `specimen-registry/sar-web` for the app, `specimen-registry/sar-data` for the data corpus if we open-source that separately.

---

## 8. Governance and licensing

- **Code license:** MIT.
- **Data license:** CC BY 4.0 (attribution required). Standard for open scientific databases.
- **Attribution requirement:** SAR data must cite specific publications when reused. This is enforced socially, not technically.
- **Editorial policy:** SAR records what published papers say. Corrections require a published erratum or retraction. No individual specialist can edit SAR entries in v0 (v1 will add moderated write access).
- **Verification standard:** every public claim has a quoted passage + DOI + page number. Non-negotiable, no exceptions.
- **No advocacy positions.** SAR does not take sides on contested interpretations. If two papers disagree on a specimen's assignment, SAR shows both with their source quotes.

---

## 9. Launch plan (v0)

| Phase | Weeks | Deliverable |
|---|---|---|
| 1. Spec approval | this week | You approve or edit this spec |
| 2. Paper corpus scope | week 1 | Manifest of ~35–50 Denisova papers with DOIs |
| 3. Domain + repo | week 1 | Domain purchased (with confirm_action), GitHub repo/org created |
| 4. Schema + scaffold | week 2 | Neon DB + Cloudflare Worker + Hono up; empty schema deployed |
| 5. First 3 papers | week 2–3 | Ingest workflow proven end-to-end on 3 papers; Michael reviews the verification quotes |
| 6. Remaining papers | weeks 3–6 | Ingest continues on evenings; ~5–8 papers/week |
| 7. Public front-end | weeks 5–6 | Search, specimen pages, publication pages, methods filter |
| 8. Alpha (private) | end of week 6 | Full v0 live at the domain with basic-auth password gate; you review |
| 9. Alpha review | week 7 | You + 2–3 friendly non-Ship-recipient specialists review; feedback incorporated |
| 10. v0.1 public | end of week 8 | Public launch, README + short technical write-up posted to r/Paleontology, Bluesky #archaeology, no direct emails |

---

## 10. Success criteria for v0

- 100% of published specimen-level facts for Denisova Cave (as of a defined cutoff date) are ingested with source-locked verification.
- Zero fabricated citations. Zero from-memory claims. This is the CHEE sprint discipline enforced technically.
- Public site loads any specimen page in under 500ms globally (Cloudflare edge).
- README + technical write-up drafted and posted.
- At least one external star / fork / issue within 30 days of public launch. (Weak signal but useful.)

Not a success criterion: any specific specialist response, especially from the four Ship recipients.

---

## 11. Explicit failure modes to avoid

Documented so future-me doesn't drift.

1. **Emailing any Ship recipient about SAR.** Ever. Do not. Rule 1 of project instructions.
2. **Repeating the CHEE fabricated-citation failure mode.** Every citation in SAR is fetched-and-quoted, never from memory. This is enforced by the ingest workflow's mandatory quoted-passage field.
3. **Feature creep before v0 is stable.** No PDF automation, no write API, no specialist accounts, no additional sites until v0 is public and stable.
4. **Confusing SAR with FQHC 340B Compliance.** Separate domain, separate GitHub, separate identity. SAR must be able to be handed off to a nonprofit or foundation someday without any entanglement.
5. **Trying to be a scientific authority instead of an infrastructure authority.** SAR does not editorialize, does not rank, does not judge. It records what published sources say.

---

## 12. Open questions for Michael

1. **Domain: `.org` or `.io`?** My recommendation `.org` for nonprofit-infrastructure positioning.
2. **GitHub org: separate `specimen-registry` org, or under an existing org?** My recommendation: separate.
3. **Public repo from day 1, or private until v0.1?** My recommendation: public from day 1 — signals genuine open-infrastructure intent.
4. **Do you want to be listed as sole author/maintainer, or "Michael Gonzalez and contributors" with contributor section from the start?** My recommendation: sole for v0, expand as contributors join.
5. **AI-assistance disclosure text: full disclosure on the "About" page, or also in the README?** My recommendation: both, prominently.
6. **Alpha reviewers: I'll suggest 2–3 non-Ship-recipient specialists in the paper-corpus manifest phase. Approve me curating that list, or want to pick yourself?** My recommendation: I curate, you approve before any outreach.

---

## 13. What happens next after you approve this spec

1. I draft `PAPER_CORPUS_MANIFEST.md` (Denisova papers with DOIs, priority tier, verification status).
2. I do a whois check on `specimenregistry.org` and `.io` and report back.
3. You review both. If you approve, we do domain purchase via confirm_action and set up the repo.
4. Build phase begins.

**Nothing external happens without confirm_action.** Domain purchase, GitHub org creation, any public post — all gated on your explicit approval.
