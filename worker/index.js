// SAR v0.0.3 — Neon-backed specimen registry Worker
// Uses the Neon HTTP driver bundled inline (no npm install required).
// Reads DATABASE_URL from wrangler secret.

import { neon } from "@neondatabase/serverless";

const VERSION = "0.0.3-neon";
const BUILD_DATE = "2026-07-26";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...(init.headers ?? {}) },
  });
}

function text(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, ...(init.headers ?? {}) },
  });
}

function html(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...CORS, ...(init.headers ?? {}) },
  });
}

// ---------- Homepage --------------------------------------------------

async function renderHomepage(sql) {
  const pubs = await sql`
    SELECT id, title, year, journal,
           (SELECT COUNT(*) FROM specimens s WHERE s.assignment_publication = p.id
                                                OR s.provenance_publication = p.id) AS specimen_count
    FROM publications p
    ORDER BY year DESC, id
  `;

  const specimenCount = (await sql`SELECT COUNT(*)::int AS n FROM specimens`)[0].n;
  const analysisCount = (await sql`SELECT COUNT(*)::int AS n FROM analyses`)[0].n;
  const siteCount = (await sql`SELECT COUNT(*)::int AS n FROM sites`)[0].n;

  const rows = pubs
    .map(
      (p) => `<tr>
        <td><a href="/publications/${encodeURIComponent(p.id)}">${p.id}</a></td>
        <td>${p.year ?? ""}</td>
        <td>${escapeHtml(p.title ?? "")}</td>
        <td>${escapeHtml(p.journal ?? "")}</td>
        <td style="text-align:right">${p.specimen_count}</td>
      </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Specimen Registry — SAR v${VERSION}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    body { font: 15px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
    .muted { color: #666; font-size: .9em; }
    .stats { display: flex; gap: 2rem; margin: 1.5rem 0; padding: .75rem 1rem; background: #f4f4f4; border-radius: 6px; }
    .stat { font-weight: 600; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #ddd; font-size: 14px; vertical-align: top; }
    th { background: #fafafa; }
    a { color: #0645ad; text-decoration: none; }
    a:hover { text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body { background: #111; color: #eee; }
      .stats { background: #1e1e1e; }
      th { background: #1a1a1a; }
      th, td { border-bottom-color: #333; }
      a { color: #6bb0f5; }
    }
  </style>
</head>
<body>
  <h1>Specimen Registry — Denisova pilot corpus</h1>
  <p class="muted">SAR v${VERSION}. Backing store: Neon Postgres. All rows in <code>verification_state='draft'</code>.</p>
  <div class="stats">
    <span class="stat">${pubs.length} publications</span>
    <span class="stat">${specimenCount} specimens</span>
    <span class="stat">${analysisCount} analyses</span>
    <span class="stat">${siteCount} sites</span>
  </div>
  <table>
    <thead><tr><th>DOI</th><th>Year</th><th>Title</th><th>Journal</th><th>Specimens</th></tr></thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p class="muted" style="margin-top: 2rem;">
    API endpoints:
    <a href="/corpus">/corpus</a> ·
    <a href="/specimens">/specimens</a> ·
    <a href="/sites">/sites</a> ·
    <a href="/publications">/publications</a> ·
    <a href="/analyses">/analyses</a> ·
    <a href="/health">/health</a> ·
    <a href="/version">/version</a>
  </p>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------- Routes ---------------------------------------------------

async function routeCorpus(sql) {
  // Same shape as v0.0.2 for backward compat, but data comes from Neon.
  const pubs = await sql`
    SELECT id, title, year, journal, authors, verification_state
    FROM publications ORDER BY year DESC, id
  `;
  return json({
    version: VERSION,
    source: "neon://sar-v0.publications",
    count: pubs.length,
    papers: pubs.map((p) => ({
      id: p.id,
      short_title: p.title,
      year: p.year,
      journal: p.journal,
      first_author: Array.isArray(p.authors) && p.authors.length ? p.authors[0] : null,
      author_count: Array.isArray(p.authors) ? p.authors.length : 0,
      verification_state: p.verification_state,
    })),
  });
}

async function routeSpecimens(sql, url) {
  const site_id = url.searchParams.get("site_id");
  const rows = site_id
    ? await sql`
        SELECT s.id, s.site_id, s.common_name, s.taxonomic_assignment, s.assignment_method,
               s.assignment_publication, s.verification_state,
               (SELECT COUNT(*)::int FROM analyses a WHERE a.specimen_id = s.id) AS analysis_count
        FROM specimens s WHERE s.site_id = ${site_id} ORDER BY s.id
      `
    : await sql`
        SELECT s.id, s.site_id, s.common_name, s.taxonomic_assignment, s.assignment_method,
               s.assignment_publication, s.verification_state,
               (SELECT COUNT(*)::int FROM analyses a WHERE a.specimen_id = s.id) AS analysis_count
        FROM specimens s ORDER BY s.id
      `;
  return json({
    version: VERSION,
    filter: site_id ? { site_id } : null,
    count: rows.length,
    specimens: rows,
  });
}

async function routeSpecimenById(sql, id) {
  const rows = await sql`SELECT * FROM specimens WHERE id = ${id}`;
  if (rows.length === 0) return json({ error: "not_found", id }, { status: 404 });
  const spec = rows[0];
  // Strip the raw markdown blob from verification_notes to keep the payload readable
  if (spec.verification_notes && spec.verification_notes.includes("---RAW MARKDOWN---")) {
    spec.verification_notes = spec.verification_notes.split("---RAW MARKDOWN---")[0].trim();
  }
  const analyses = await sql`
    SELECT id, publication_id, method, dating_method, lab, analysis_date,
           result_summary, result_summary_source_quote, verification_state
    FROM analyses WHERE specimen_id = ${id} ORDER BY publication_id, method
  `;
  const site = spec.site_id ? (await sql`SELECT * FROM sites WHERE id = ${spec.site_id}`)[0] : null;
  return json({ version: VERSION, specimen: spec, site, analyses });
}

async function routeSites(sql) {
  const rows = await sql`
    SELECT s.*,
           (SELECT COUNT(*)::int FROM specimens sp WHERE sp.site_id = s.id) AS specimen_count
    FROM sites s ORDER BY s.id
  `;
  return json({ version: VERSION, count: rows.length, sites: rows });
}

async function routeSiteById(sql, id) {
  const rows = await sql`SELECT * FROM sites WHERE id = ${id}`;
  if (rows.length === 0) return json({ error: "not_found", id }, { status: 404 });
  const specimens = await sql`
    SELECT id, common_name, taxonomic_assignment, assignment_method, verification_state
    FROM specimens WHERE site_id = ${id} ORDER BY id
  `;
  return json({ version: VERSION, site: rows[0], specimens });
}

async function routePublications(sql) {
  const rows = await sql`
    SELECT id, title, year, journal, authors, verification_state,
           (SELECT COUNT(*)::int FROM analyses a WHERE a.publication_id = p.id) AS analysis_count,
           (SELECT COUNT(*)::int FROM specimens s
              WHERE s.assignment_publication = p.id OR s.provenance_publication = p.id) AS specimen_count
    FROM publications p ORDER BY year DESC, id
  `;
  return json({ version: VERSION, count: rows.length, publications: rows });
}

async function routePublicationById(sql, id) {
  const rows = await sql`SELECT * FROM publications WHERE id = ${id}`;
  if (rows.length === 0) return json({ error: "not_found", id }, { status: 404 });
  const pub = rows[0];
  if (pub.verification_notes && pub.verification_notes.includes("---RAW MARKDOWN---")) {
    pub.verification_notes = pub.verification_notes.split("---RAW MARKDOWN---")[0].trim();
  }
  const specimens = await sql`
    SELECT id, common_name, taxonomic_assignment, assignment_method, verification_state
    FROM specimens
    WHERE assignment_publication = ${id} OR provenance_publication = ${id}
    ORDER BY id
  `;
  const analyses = await sql`
    SELECT id, specimen_id, method, dating_method, lab, result_summary, verification_state
    FROM analyses WHERE publication_id = ${id} ORDER BY specimen_id, method
  `;
  return json({ version: VERSION, publication: pub, specimens, analyses });
}

async function routeAnalyses(sql, url) {
  const spec = url.searchParams.get("specimen_id");
  const pub = url.searchParams.get("publication_id");
  let rows;
  if (spec) {
    rows = await sql`SELECT * FROM analyses WHERE specimen_id = ${spec} ORDER BY publication_id, method`;
  } else if (pub) {
    rows = await sql`SELECT * FROM analyses WHERE publication_id = ${pub} ORDER BY specimen_id, method`;
  } else {
    rows = await sql`SELECT * FROM analyses ORDER BY specimen_id, publication_id, method`;
  }
  return json({ version: VERSION, count: rows.length, analyses: rows });
}

// ---------- Entry ----------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Static routes
    if (path === "/health") return json({ status: "ok", ts: new Date().toISOString() });
    if (path === "/version") {
      return json({
        service: "specimen-registry",
        version: VERSION,
        build_date: BUILD_DATE,
        stage: "pilot-corpus",
        backing_store: "neon-postgres",
      });
    }

    // DB-backed routes
    if (!env.DATABASE_URL) {
      return json({ error: "DATABASE_URL not configured" }, { status: 500 });
    }
    const sql = neon(env.DATABASE_URL);

    try {
      if (path === "/") return html(await renderHomepage(sql));
      if (path === "/corpus") return await routeCorpus(sql);

      if (path === "/specimens") return await routeSpecimens(sql, url);
      const specM = path.match(/^\/specimens\/([^/]+)$/);
      if (specM) return await routeSpecimenById(sql, decodeURIComponent(specM[1]));

      if (path === "/sites") return await routeSites(sql);
      const siteM = path.match(/^\/sites\/([^/]+)$/);
      if (siteM) return await routeSiteById(sql, decodeURIComponent(siteM[1]));

      if (path === "/publications") return await routePublications(sql);
      const pubM = path.match(/^\/publications\/([^/]+)$/);
      if (pubM) return await routePublicationById(sql, decodeURIComponent(pubM[1]));

      if (path === "/analyses") return await routeAnalyses(sql, url);

      // Legacy /corpus/:id (from v0.0.2) → redirect to /publications/:id
      const legacy = path.match(/^\/corpus\/([^/]+)$/);
      if (legacy) return await routePublicationById(sql, decodeURIComponent(legacy[1]));

      return json({ error: "not_found", path }, { status: 404 });
    } catch (err) {
      return json({ error: "internal", message: String(err?.message ?? err) }, { status: 500 });
    }
  },
};
