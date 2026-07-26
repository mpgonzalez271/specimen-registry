# SAR Blockers — waiting on Michael

Anything I couldn't move past without you goes here. Ordered by what unlocks the most downstream work.

## Open

### B-001 · Neon connection string — need it in a usable form
**Status:** waiting
**Impact:** blocks schema deploy, Worker DB wiring, and all ingest-to-DB work (Worker skeleton + paper-ingest content stays in git either way)
**Context:** you already created the Neon project and got the connection string, but the credential vault rejected both a `bearer` and a `header` credential type (proxy can't route Postgres wire protocol on port 5432).
**Resolution paths (pick one when you're back):**
1. Paste the connection string directly into `/home/user/workspace/sar/.env` (I already added it to `.gitignore` so it never leaves the sandbox)
2. Give me a Neon **API key** (from https://console.neon.tech/app/settings/api-keys) — that key IS a bearer token, works cleanly through the vault, and lets me create the project/branch/connection-string programmatically without you pasting the raw string
**Preferred:** option 2 (Neon API key). Cleaner, more repeatable, matches how we handle Cloudflare + GitHub.

## Done in this batch

- 2026-07-26: BLOCKERS file created (B-001 Neon connection string — still open)
- 2026-07-26: Nine tier-1 ingest records added (T1.2, T1.3, T1.4, T1.6, T1.8, T1.9, T1.10, T1.11, T1.12)
- 2026-07-26: Worker skeleton live at specimenregistry.org (200 on /, /health, /version)
- 2026-07-26: Ingest linter deployed; all 12 records now pass strict lint (missing quotes for T1.2 / T1.3 / T1.6 pulled from Europe PMC and Crossref records mid-block — B-002 closed)

## Closed

### B-002 · Three tier-1 ingest records lacked source-locked quotes
**Status:** CLOSED 2026-07-26
**Resolution:** Verbatim abstracts pulled from Europe PMC (T1.3 Prüfer 2014, T1.6 Chen 2019) and Crossref editorial summary (T1.2 Meyer 2012); all three now carry ≥2 source-locked quotes each and pass strict lint. Human reviewer still needs to cross-check against paper PDFs before promoting from DRAFT to source-locked, but the linter no longer flags them.
