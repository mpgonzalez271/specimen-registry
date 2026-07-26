// SAR v0.0.4 — Neon-backed specimen registry Worker
// Adds pagination (limit/offset), /search full-text route, and small robustness fixes.
// Reads DATABASE_URL from wrangler binding (inherit secret).

import { neon } from "@neondatabase/serverless";

const VERSION = "0.0.4-neon";
const BUILD_DATE = "2026-07-26";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

function parsePaging(url) {
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "", 10);
  const rawOffset = parseInt(url.searchParams.get("offset") ?? "", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}

function pageMeta(limit, offset, count, total) {
  const nextOffset = offset + count;
  return {
    limit,
    offset,
    count,
    total,
    next_offset: nextOffset < total ? nextOffset : null,
  };
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
      (p) => `
    <tr>
      <td><a href="/publications/${encodeURIComponent(p.id)}"><code>${p.id}</code></a></td>
      <td>${escapeHtml(p.title ?? "")}</td>
      <td>${p.year ?? ""}</td>
      <td>${escapeHtml(p.journal ?? "")}</td>
      <td style="text-align:right">${p.specimen_count ?? 0}</td>
    </tr>`
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Specimen Registry</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #111; }
h1 { margin-bottom: 0.2rem; } .muted { color: #666; }
table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
th, td { border-bottom: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
code { background: #f4f4f4; padding: 0 0.25rem; border-radius: 3px; }
.pill { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; background: #eef; color: #224; font-size: 0.85rem; }
</style></head><body>
<h1>Specimen Registry v0</h1>
<p class="muted">Neon-backed public read API. Pilot corpus: Denisova Cave and related sites.</p>
<p>
  <span class="pill">${pubs.length} publications</span>
  <span class="pill">${specimenCount} specimens</span>
  <span class="pill">${analysisCount} analyses</span>
  <span class="pill">${siteCount} sites</span>
</p>
<p>
  API index:
  <a href="/corpus">/corpus</a> ·
  <a href="/publications">/publications</a> ·
  <a href="/specimens">/specimens</a> ·
  <a href="/sites">/sites</a> ·
  <a href="/analyses">/analyses</a> ·
  <a href="/search?q=Denisovan">/search?q=</a> ·
  <a href="/version">/version</a>
</p>
<table>
<thead><tr><th>ID (DOI)</th><th>Title</th><th>Year</th><th>Journal</th><th style="text-align:right">Specimens</th></tr></thead>
<tbody>${rows}</tbody></table>
<p class="muted" style="margin-top:2rem;font-size:0.85rem">
  v${VERSION} · built ${BUILD_DATE} · <a href="https://github.com/mpgonzalez271/specimen-registry">source</a>
</p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Routes ----------------------------------------------------

async function routeCorpus(sql) {
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
  const { limit, offset } = parsePaging(url);

  const total = site_id
    ? (await sql`SELECT COUNT(*)::int AS n FROM specimens WHERE site_id = ${site_id}`)[0].n
    : (await sql`SELECT COUNT(*)::int AS n FROM specimens`)[0].n;

  const rows = site_id
    ? await sql`
        SELECT s.id, s.site_id, s.common_name, s.taxonomic_assignment, s.assignment_method,
               s.assignment_publication, s.verification_state,
               (SELECT COUNT(*)::int FROM analyses a WHERE a.specimen_id = s.id) AS analysis_count
        FROM specimens s WHERE s.site_id = ${site_id}
        ORDER BY s.id LIMIT ${limit} OFFSET ${offset}
      `
    : await sql`
        SELECT s.id, s.site_id, s.common_name, s.taxonomic_assignment, s.assignment_method,
               s.assignment_publication, s.verification_state,
               (SELECT COUNT(*)::int FROM analyses a WHERE a.specimen_id = s.id) AS analysis_count
        FROM specimens s ORDER BY s.id LIMIT ${limit} OFFSET ${offset}
      `;
  return json({
    version: VERSION,
    filter: site_id ? { site_id } : null,
    ...pageMeta(limit, offset, rows.length, total),
    specimens: rows,
  });
}

async function routeSpecimenById(sql, id) {
  const rows = await sql`SELECT * FROM specimens WHERE id = ${id}`;
  if (rows.length === 0) return json({ error: "not_found", id }, { status: 404 });
  const spec = rows[0];
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

async function routeSites(sql, url) {
  const { limit, offset } = parsePaging(url);
  const total = (await sql`SELECT COUNT(*)::int AS n FROM sites`)[0].n;
  const rows = await sql`
    SELECT s.*,
           (SELECT COUNT(*)::int FROM specimens sp WHERE sp.site_id = s.id) AS specimen_count
    FROM sites s ORDER BY s.id LIMIT ${limit} OFFSET ${offset}
  `;
  return json({
    version: VERSION,
    ...pageMeta(limit, offset, rows.length, total),
    sites: rows,
  });
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

async function routePublications(sql, url) {
  const { limit, offset } = parsePaging(url);
  const total = (await sql`SELECT COUNT(*)::int AS n FROM publications`)[0].n;
  const rows = await sql`
    SELECT id, title, year, journal, authors, verification_state,
           (SELECT COUNT(*)::int FROM analyses a WHERE a.publication_id = p.id) AS analysis_count,
           (SELECT COUNT(*)::int FROM specimens s
              WHERE s.assignment_publication = p.id OR s.provenance_publication = p.id) AS specimen_count
    FROM publications p ORDER BY year DESC, id LIMIT ${limit} OFFSET ${offset}
  `;
  return json({
    version: VERSION,
    ...pageMeta(limit, offset, rows.length, total),
    publications: rows,
  });
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
  const { limit, offset } = parsePaging(url);

  let rows;
  let total;
  if (spec) {
    total = (await sql`SELECT COUNT(*)::int AS n FROM analyses WHERE specimen_id = ${spec}`)[0].n;
    rows = await sql`
      SELECT * FROM analyses WHERE specimen_id = ${spec}
      ORDER BY publication_id, method LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (pub) {
    total = (await sql`SELECT COUNT(*)::int AS n FROM analyses WHERE publication_id = ${pub}`)[0].n;
    rows = await sql`
      SELECT * FROM analyses WHERE publication_id = ${pub}
      ORDER BY specimen_id, method LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    total = (await sql`SELECT COUNT(*)::int AS n FROM analyses`)[0].n;
    rows = await sql`
      SELECT * FROM analyses
      ORDER BY specimen_id, publication_id, method LIMIT ${limit} OFFSET ${offset}
    `;
  }
  return json({
    version: VERSION,
    filter: spec ? { specimen_id: spec } : pub ? { publication_id: pub } : null,
    ...pageMeta(limit, offset, rows.length, total),
    analyses: rows,
  });
}

async function routeSearch(sql, url) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const type = (url.searchParams.get("type") ?? "").trim().toLowerCase();
  const { limit, offset } = parsePaging(url);

  if (!q) {
    return json({
      error: "missing_query",
      message: "?q= is required. Optional: ?type=publication|specimen&limit=&offset=",
    }, { status: 400 });
  }
  if (type && type !== "publication" && type !== "specimen") {
    return json({
      error: "invalid_type",
      message: "type must be 'publication' or 'specimen' (or omitted for both)",
    }, { status: 400 });
  }

  const results = { query: q, type: type || "both", limit, offset };

  if (type === "" || type === "publication") {
    const total = (await sql`
      SELECT COUNT(*)::int AS n FROM publications
      WHERE fts_tsv @@ plainto_tsquery('english', ${q})
    `)[0].n;
    const rows = await sql`
      SELECT id, title, year, journal,
             ts_rank(fts_tsv, plainto_tsquery('english', ${q})) AS rank
      FROM publications
      WHERE fts_tsv @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC, year DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    results.publications = {
      total,
      count: rows.length,
      next_offset: offset + rows.length < total ? offset + rows.length : null,
      hits: rows,
    };
  }

  if (type === "" || type === "specimen") {
    const total = (await sql`
      SELECT COUNT(*)::int AS n FROM specimens
      WHERE fts_tsv @@ plainto_tsquery('english', ${q})
    `)[0].n;
    const rows = await sql`
      SELECT id, common_name, taxonomic_assignment, assignment_method, verification_state,
             ts_rank(fts_tsv, plainto_tsquery('english', ${q})) AS rank
      FROM specimens
      WHERE fts_tsv @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC, id
      LIMIT ${limit} OFFSET ${offset}
    `;
    results.specimens = {
      total,
      count: rows.length,
      next_offset: offset + rows.length < total ? offset + rows.length : null,
      hits: rows,
    };
  }

  return json({ version: VERSION, ...results });
}

// ---------- Entry ----------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (path === "/health") return json({ status: "ok", ts: new Date().toISOString() });
    if (path === "/version") {
      return json({
        service: "specimen-registry",
        version: VERSION,
        build_date: BUILD_DATE,
        stage: "pilot-corpus",
        backing_store: "neon-postgres",
        capabilities: ["pagination", "fts-search"],
      });
    }

    if (!env.DATABASE_URL) {
      return json({ error: "DATABASE_URL not configured" }, { status: 500 });
    }
    const sql = neon(env.DATABASE_URL);

    try {
      if (path === "/") return html(await renderHomepage(sql));
      if (path === "/corpus") return await routeCorpus(sql);
      if (path === "/search") return await routeSearch(sql, url);

      if (path === "/specimens") return await routeSpecimens(sql, url);
      const specM = path.match(/^\/specimens\/([^/]+)$/);
      if (specM) return await routeSpecimenById(sql, decodeURIComponent(specM[1]));

      if (path === "/sites") return await routeSites(sql, url);
      const siteM = path.match(/^\/sites\/([^/]+)$/);
      if (siteM) return await routeSiteById(sql, decodeURIComponent(siteM[1]));

      if (path === "/publications") return await routePublications(sql, url);
      const pubM = path.match(/^\/publications\/([^/]+)$/);
      if (pubM) return await routePublicationById(sql, decodeURIComponent(pubM[1]));

      if (path === "/analyses") return await routeAnalyses(sql, url);

      const legacy = path.match(/^\/corpus\/([^/]+)$/);
      if (legacy) return await routePublicationById(sql, decodeURIComponent(legacy[1]));

      return json({ error: "not_found", path }, { status: 404 });
    } catch (err) {
      return json({ error: "internal", message: String(err?.message ?? err) }, { status: 500 });
    }
  },
};
