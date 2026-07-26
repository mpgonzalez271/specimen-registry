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

_None yet — this file just created._
