# SAR — Cloudflare Worker Application Skeleton

## Overview

SAR v0 is a **server-rendered read-only registry** served by a single Cloudflare Worker with Hono routing. It reads from Neon Postgres via Hyperdrive-cached queries and returns HTML.

**Read-only for v0.** All writes happen via CLI ingest scripts, never through the web UI. This is deliberate — the web front-end is a display layer, not a content-management system. Editorial discipline lives in the ingest pipeline (see `INGEST_RUNBOOK_v0.md`).

## Stack

- **Runtime:** Cloudflare Workers (Node.js compatibility mode enabled)
- **Framework:** Hono (`hono` npm package, lightweight edge-friendly routing)
- **Database:** Neon Postgres (via `@neondatabase/serverless` driver)
- **Templating:** Hono's built-in JSX for HTML rendering (SSR only, no client hydration in v0)
- **Search:** Postgres FTS via `tsvector` columns already defined in schema
- **CSS:** Single stylesheet, custom minimal design — see brand direction below

## Routes (v0)

| Path | Description |
|---|---|
| `/` | Home page — SAR intro, corpus stats, latest additions |
| `/about` | About page — mission, methodology, AI disclosure, contact |
| `/sites` | List of all sites (Denisova Cave only in v0, more later) |
| `/sites/:id` | Site page — description + all specimens from that site |
| `/specimens` | Browsable list of all specimens, filtered by taxa/site |
| `/specimens/:id` | Specimen page — full record, analyses, publications, source-locked quotes |
| `/publications` | List of all publications indexed |
| `/publications/:doi` | Publication page — full metadata + specimens/analyses linked |
| `/search?q=...` | FTS search across sites, specimens, publications |
| `/api/v1/specimens.json` | JSON export of all `source-locked` specimens (public API) |
| `/api/v1/specimens/:id.json` | JSON export of a specific specimen record |
| `/api/v1/schema` | JSON Schema description of the data model |

## API Contract

All API responses follow the format:

```json
{
  "meta": {
    "api_version": "v1",
    "generated_at": "2026-07-26T13:45:00Z",
    "record_count": 42,
    "citation": "Specimen Registry v0.1, https://specimenregistry.org/api/v1/specimens.json (accessed <date>)"
  },
  "data": [ /* records */ ]
}
```

Every response includes a `citation` field that specialists can quote if they use SAR data — this is deliberate infrastructure-authority signaling.

## Environment variables

Set as Cloudflare Worker secrets:

- `DATABASE_URL` — Neon Postgres connection string (with Hyperdrive)
- `ADMIN_TOKEN` — used for `/admin` routes if any are added in v0.2 (not v0)

## Application skeleton (worker entry point)

```typescript
// src/index.ts
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { html } from 'hono/html';
import { serveStatic } from 'hono/cloudflare-workers';
import { renderer } from './renderer';

type Env = {
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Env }>();

// Middleware: layout wrapper
app.use('*', renderer);

// Home page
app.get('/', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const [{ count: specimen_count }] = await sql`SELECT count(*) FROM specimens WHERE verification_state = 'source-locked'`;
  const [{ count: publication_count }] = await sql`SELECT count(*) FROM publications WHERE verification_state = 'source-locked'`;
  const [{ count: site_count }] = await sql`SELECT count(*) FROM sites WHERE verification_state = 'source-locked'`;
  return c.render(
    <>
      <h1>Specimen Registry</h1>
      <p>A source-locked registry of published Late Pleistocene hominin specimens.</p>
      <dl class="stats">
        <div><dt>Specimens</dt><dd>{specimen_count}</dd></div>
        <div><dt>Publications</dt><dd>{publication_count}</dd></div>
        <div><dt>Sites</dt><dd>{site_count}</dd></div>
      </dl>
      <p>Every record traces to a peer-reviewed publication with a verbatim quoted passage. See <a href="/about">About</a> for methodology.</p>
    </>
  );
});

// About page — static content
app.get('/about', async (c) => c.render(<AboutPage />));

// Specimen list
app.get('/specimens', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql`
    SELECT id, common_name, taxonomic_assignment, site_id, material_type
    FROM specimens
    WHERE verification_state = 'source-locked'
    ORDER BY common_name`;
  return c.render(<SpecimensList specimens={rows} />);
});

// Specimen detail
app.get('/specimens/:id', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const id = c.req.param('id');
  const [specimen] = await sql`
    SELECT s.*, si.name AS site_name, si.country AS site_country
    FROM specimens s
    JOIN sites si ON s.site_id = si.id
    WHERE s.id = ${id} AND s.verification_state = 'source-locked'`;
  if (!specimen) return c.notFound();
  const analyses = await sql`
    SELECT a.*, p.title AS publication_title, p.year AS publication_year, p.journal AS publication_journal
    FROM analyses a
    JOIN publications p ON a.publication_id = p.id
    WHERE a.specimen_id = ${id} AND a.verification_state = 'source-locked'
    ORDER BY p.year`;
  return c.render(<SpecimenDetail specimen={specimen} analyses={analyses} />);
});

// FTS search
app.get('/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.render(<SearchForm />);
  const sql = neon(c.env.DATABASE_URL);
  const results = await sql`
    (SELECT 'specimen' AS kind, id, common_name AS title, taxonomic_assignment AS subtitle FROM specimens WHERE fts_tsv @@ plainto_tsquery('english', ${q}) AND verification_state = 'source-locked')
    UNION ALL
    (SELECT 'publication' AS kind, id, title, journal AS subtitle FROM publications WHERE fts_tsv @@ plainto_tsquery('english', ${q}) AND verification_state = 'source-locked')
    LIMIT 50`;
  return c.render(<SearchResults query={q} results={results} />);
});

// JSON API
app.get('/api/v1/specimens.json', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql`SELECT * FROM specimens WHERE verification_state = 'source-locked' ORDER BY id`;
  return c.json({
    meta: {
      api_version: 'v1',
      generated_at: new Date().toISOString(),
      record_count: rows.length,
      citation: `Specimen Registry v0.1, ${c.req.url}, accessed ${new Date().toISOString().slice(0, 10)}`
    },
    data: rows
  });
});

export default app;
```

## Design direction (v0 look)

- **Typography:** Serif for body copy (something like Source Serif Pro or IBM Plex Serif), sans for UI chrome (Inter or IBM Plex Sans). Reason: matches the scholarly-registry tone; not tech-startup.
- **Palette:** off-white background (`#faf8f5`), warm dark ink text (`#1c1917`), one accent color (deep archaeologist ochre — `#8a6d3b` or similar). Deliberately un-flashy.
- **Layout:** single-column, max-width 720px on desktop. Every specimen page reads like a museum catalog card, not a database row.
- **Table density:** low. Whitespace over cramming.
- **Source-locked quotes:** rendered inline in italics with a small "verbatim" tag and the DOI hyperlinked at the end.
- **Loud verification chips:** every specimen page shows its verification state clearly — a green "source-locked" chip for verified, an orange "disputed" chip if flagged.

**The site should feel like a serious reference resource, not a product.** No animations, no sticky elements, no cookie banner beyond legal minimum, no analytics beyond Cloudflare's built-in aggregate stats.

## Deployment plan

1. Wire `wrangler.toml` to point at `sar-v0-prod` Workers project.
2. Provision Neon database on free tier (up to 0.5 GB storage, sufficient for v0).
3. Attach Hyperdrive binding for connection pooling to the Worker.
4. Run schema DDL against Neon.
5. Ingest 12 tier-1 papers via CLI script into `pending-verification` state.
6. Michael reviews 12 papers, promotes to `source-locked`.
7. Deploy Worker to `specimenregistry.workers.dev`.
8. Custom domain `specimenregistry.org` (once purchase confirmed).
9. Alpha review by 2-3 specialists (Michael-approved list).
10. Public launch v0.1.

## Not in v0 (deliberately)

- No user accounts, comments, or edit interface.
- No specimen submissions from public.
- No image storage (specimen images are copyrighted; link to publisher pages instead).
- No 3D model viewer for micro-CT scans (add in v0.2 if useful).
- No i18n (English only in v0).
- No mobile app.

These constraints are the point. Ship the minimum credible thing.

## Testing before public launch

- Smoke test: every route returns 200 for known-good inputs.
- Data integrity: every publication has ≥1 specimen; every specimen has ≥1 analysis.
- Byline integrity: random sample of 5 publications' Crossref-verified bylines match what's in the database.
- API contract: `/api/v1/specimens.json` returns valid JSON matching schema.
- Accessibility: WCAG 2.1 AA baseline (color contrast, semantic HTML, keyboard nav, alt text where images exist).
