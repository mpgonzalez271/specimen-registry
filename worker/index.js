// SAR v0.0.5 — Neon-backed specimen registry Worker
// - Adds /license, /comparisons, /graph/:specimen_id endpoints
// - Adds citation field to every JSON response
// - Adds HTML detail pages for /specimens/:id, /publications/:id, /sites/:id
// - Adds interactive /search HTML UI
// - Adds soft in-memory rate limiting (per-Worker) and Neon access_log via ctx.waitUntil
// - Full data license disclosure at /license (CC BY 4.0)

import { neon } from "@neondatabase/serverless";

const VERSION = "0.0.13-neon";
const BUILD_DATE = "2026-07-28";
const CITATION = "Specimen Registry v0.0.13 (2026). Maintained by Michael Gonzalez with AI assistance. https://specimenregistry.org. Data licensed under CC BY 4.0.";
const LICENSE_URL = "https://specimenregistry.org/license";
const SOURCE_URL = "https://github.com/mpgonzalez271/specimen-registry";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ---- Rate limiting (best-effort, per-Worker instance) ---------------------
// Sliding window: 60 req/min per IP hash, 600/hour, hard cap 5000/day.
const RATE_LIMITS = { minute: 60, hour: 600, day: 5000 };
const rateCache = new Map();

function checkRate(ipHash) {
  const now = Date.now();
  const rec = rateCache.get(ipHash) ?? { minute: [], hour: [], day: [] };
  rec.minute = rec.minute.filter((t) => now - t < 60_000);
  rec.hour = rec.hour.filter((t) => now - t < 3_600_000);
  rec.day = rec.day.filter((t) => now - t < 86_400_000);
  if (rec.minute.length >= RATE_LIMITS.minute) return { ok: false, retry_after: 60, window: "minute", limit: RATE_LIMITS.minute };
  if (rec.hour.length >= RATE_LIMITS.hour) return { ok: false, retry_after: 3600, window: "hour", limit: RATE_LIMITS.hour };
  if (rec.day.length >= RATE_LIMITS.day) return { ok: false, retry_after: 86400, window: "day", limit: RATE_LIMITS.day };
  rec.minute.push(now); rec.hour.push(now); rec.day.push(now);
  rateCache.set(ipHash, rec);
  return { ok: true, remaining: { minute: RATE_LIMITS.minute - rec.minute.length, hour: RATE_LIMITS.hour - rec.hour.length, day: RATE_LIMITS.day - rec.day.length } };
}

async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Helpers --------------------------------------------------------------

function json(body, init = {}) {
  const withCitation = typeof body === "object" && body !== null && !Array.isArray(body)
    ? { citation: CITATION, license: LICENSE_URL, ...body }
    : body;
  const headers = { "content-type": "application/json; charset=utf-8", ...CORS, ...(init.headers ?? {}) };
  if (init.rate_remaining) {
    headers["X-RateLimit-Remaining-Minute"] = String(init.rate_remaining.minute);
    headers["X-RateLimit-Remaining-Hour"] = String(init.rate_remaining.hour);
    headers["X-RateLimit-Remaining-Day"] = String(init.rate_remaining.day);
  }
  return new Response(JSON.stringify(withCitation, null, 2), { status: init.status ?? 200, headers });
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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function parsePaging(url) {
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "", 10);
  const rawOffset = parseInt(url.searchParams.get("offset") ?? "", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}

function pageMeta(limit, offset, count, total) {
  const nextOffset = offset + count;
  return { limit, offset, count, total, next_offset: nextOffset < total ? nextOffset : null };
}

// ---- Layout / chrome -----------------------------------------------------

function layout({ title, body, active }) {
  const nav = [
    ["/", "Home"],
    ["/publications", "Publications"],
    ["/specimens", "Specimens"],
    ["/sites", "Sites"],
    ["/analyses", "Analyses"],
    ["/comparisons", "Comparisons"],
    ["/stats", "Stats"],
    ["/timeline", "Timeline"],
    ["/random", "Random"],
    ["/search?q=Denisovan", "Search"],
    ["/license", "License"],
  ].map(([href, label]) => {
    const is = active && href.startsWith(active) ? ' style="font-weight:600"' : "";
    return `<a href="${href}"${is}>${escapeHtml(label)}</a>`;
  }).join(" · ");
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg:#fff; --fg:#111; --muted:#666; --border:#e2e2e2; --accent:#345; --code-bg:#f4f4f4; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 960px; margin: 1rem auto; padding: 0 1rem; color: var(--fg); line-height: 1.5; }
  header { border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; margin-bottom: 1.25rem; }
  header .title { font-size: 1.4rem; font-weight: 600; text-decoration: none; color: var(--fg); }
  header .nav { margin-top: 0.4rem; font-size: 0.9rem; color: var(--muted); }
  header .nav a { text-decoration: none; color: var(--accent); margin-right: 0.1rem; }
  header .nav a:hover { text-decoration: underline; }
  h1 { margin: 0.2rem 0 0.4rem; font-size: 1.4rem; }
  h2 { margin: 1.4rem 0 0.4rem; font-size: 1.1rem; }
  .muted { color: var(--muted); }
  code { background: var(--code-bg); padding: 0 0.25rem; border-radius: 3px; font-size: 0.9em; }
  pre { background: var(--code-bg); padding: 0.6rem 0.75rem; border-radius: 4px; overflow-x: auto; font-size: 0.85rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1rem; font-size: 0.92rem; }
  th, td { border-bottom: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 0.85rem; }
  .pill { display: inline-block; padding: 0.1rem 0.55rem; border-radius: 999px; background: #eef; color: #224; font-size: 0.8rem; margin-right: 0.25rem; }
  .pill.warn { background: #fef3cd; color: #6b5610; }
  .pill.ok { background: #d7f0e4; color: #14522f; }
  .quote { border-left: 3px solid var(--accent); padding: 0.3rem 0.8rem; background: #f7f9fc; margin: 0.5rem 0; font-style: italic; color: #234; }
  .grid { display: grid; grid-template-columns: 200px 1fr; gap: 0.3rem 1rem; margin: 0.6rem 0; }
  .grid dt { color: var(--muted); font-size: 0.9rem; }
  .grid dd { margin: 0; }
  form.search { display: flex; gap: 0.5rem; margin: 0.5rem 0 1rem; }
  form.search input { flex: 1; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 4px; font-size: 1rem; }
  form.search button { padding: 0.5rem 1rem; border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 4px; cursor: pointer; }
  footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; }
  a { color: var(--accent); }
  .graph-box { border: 1px solid var(--border); padding: 0.75rem 1rem; border-radius: 4px; background: #fafafa; margin: 0.5rem 0; }
  .rank { color: var(--muted); font-family: monospace; font-size: 0.85rem; }
</style></head>
<body>
<header>
  <a href="/" class="title">Specimen Registry</a>
  <span class="muted" style="margin-left:0.4rem">v${VERSION}</span>
  <div class="nav">${nav}</div>
</header>
${body}
<footer>
  v${VERSION} · built ${BUILD_DATE} · data <a href="/license">CC BY 4.0</a> · <a href="${SOURCE_URL}">source</a> · <a href="/version">/version</a>
</footer>
</body></html>`;
}

function verifPill(state) {
  const cls = state === "source-locked" ? "ok" : state === "pending-verification" ? "warn" : "";
  return `<span class="pill ${cls}">${escapeHtml(state ?? "draft")}</span>`;
}

// ---- Homepage ------------------------------------------------------------

async function renderHomepage(sql) {
  const pubs = await sql`
    SELECT id, title, year, journal,
           (SELECT COUNT(*)::int FROM specimens s WHERE s.assignment_publication = p.id OR s.provenance_publication = p.id) AS specimen_count,
           (SELECT COUNT(*)::int FROM analyses a WHERE a.publication_id = p.id) AS analysis_count
    FROM publications p ORDER BY year DESC, id
  `;
  const specimenCount = (await sql`SELECT COUNT(*)::int AS n FROM specimens`)[0].n;
  const analysisCount = (await sql`SELECT COUNT(*)::int AS n FROM analyses`)[0].n;
  const siteCount = (await sql`SELECT COUNT(*)::int AS n FROM sites`)[0].n;
  const compCount = (await sql`SELECT COUNT(*)::int AS n FROM specimen_comparisons`)[0].n;
  const lockedCount = (await sql`SELECT COUNT(*)::int AS n FROM specimens WHERE verification_state = 'source-locked'`)[0].n;
  const pendCount = (await sql`SELECT COUNT(*)::int AS n FROM specimens WHERE verification_state = 'pending-verification'`)[0].n;

  const rows = pubs.map((p) => `
    <tr>
      <td><a href="/publications/${encodeURIComponent(p.id)}"><code>${escapeHtml(p.id)}</code></a></td>
      <td>${escapeHtml(p.title ?? "")}</td>
      <td>${p.year ?? ""}</td>
      <td>${escapeHtml(p.journal ?? "")}</td>
      <td style="text-align:right">${p.specimen_count ?? 0}</td>
      <td style="text-align:right">${p.analysis_count ?? 0}</td>
    </tr>`).join("");

  const body = `
<h1>Denisovan &amp; Neanderthal specimen corpus</h1>
<p class="muted">Public read API + browsable index. Every claim traces to a peer-reviewed publication and a verbatim source quote.</p>

<form class="search" action="/search" method="get">
  <input name="q" placeholder="Search publications and specimens (e.g. Denisova 11, hybrid, mtDNA)" />
  <button type="submit">Search</button>
</form>

<p>
  <span class="pill">${pubs.length} publications</span>
  <span class="pill">${specimenCount} specimens</span>
  <span class="pill">${analysisCount} analyses</span>
  <span class="pill">${siteCount} sites</span>
  <span class="pill">${compCount} comparisons</span>
  <span class="pill ok">${lockedCount} source-locked</span>
  <span class="pill warn">${pendCount} pending verification</span>
</p>

<h2>Publications in the corpus</h2>
<table>
  <thead><tr><th>ID (DOI)</th><th>Title</th><th>Year</th><th>Journal</th><th style="text-align:right">Specimens</th><th style="text-align:right">Analyses</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<h2>What this is</h2>
<p>SAR is a small, structured, citation-first registry of hominin specimens and their published analyses. It exists because much of the primary literature on Denisovans and Neanderthals is fragmented across dozens of papers with inconsistent naming conventions, and cross-specimen comparisons are hard to reconstruct without pulling every PDF.</p>
<p>Every specimen, analysis, and comparison row is backed by a verbatim quoted passage and DOI. Records progress through three verification states: <span class="pill">draft</span> (parsed from ingest markdown), <span class="pill warn">pending-verification</span> (human reviewer has proposed a corrected assignment but not yet locked to a source quote), <span class="pill ok">source-locked</span> (human-verified against the exact quoted passage from the paper).</p>
<p>Use <a href="/search?q=hybrid">/search</a> to full-text search. Machine access: <a href="/corpus">/corpus</a>, <a href="/publications">/publications</a>, <a href="/specimens">/specimens</a>. Every JSON response carries a <code>citation</code> field with the required attribution string.</p>
`;
  return layout({ title: "Specimen Registry", body, active: "/" });
}

// ---- JSON routes ---------------------------------------------------------

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

async function routeSpecimens(sql, url, wantsHtml) {
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
        ORDER BY s.id LIMIT ${limit} OFFSET ${offset}`
    : await sql`
        SELECT s.id, s.site_id, s.common_name, s.taxonomic_assignment, s.assignment_method,
               s.assignment_publication, s.verification_state,
               (SELECT COUNT(*)::int FROM analyses a WHERE a.specimen_id = s.id) AS analysis_count
        FROM specimens s ORDER BY s.id LIMIT ${limit} OFFSET ${offset}`;
  if (!wantsHtml) return json({ version: VERSION, filter: site_id ? { site_id } : null, ...pageMeta(limit, offset, rows.length, total), specimens: rows });
  const body = `
    <h1>Specimens${site_id ? ` at <code>${escapeHtml(site_id)}</code>` : ""}</h1>
    <p class="muted">${total} total · showing ${rows.length} (offset ${offset}, limit ${limit})</p>
    <table>
      <thead><tr><th>ID</th><th>Common name</th><th>Site</th><th>Taxon</th><th>Method</th><th>Analyses</th><th>State</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><a href="/specimens/${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a></td><td>${escapeHtml(r.common_name || "")}</td><td><a href="/sites/${encodeURIComponent(r.site_id || "")}">${escapeHtml(r.site_id || "")}</a></td><td>${escapeHtml(r.taxonomic_assignment || "")}</td><td>${escapeHtml(r.assignment_method || "")}</td><td>${r.analysis_count}</td><td><span class="chip chip-${escapeHtml(r.verification_state)}">${escapeHtml(r.verification_state)}</span></td></tr>`).join("")}</tbody>
    </table>
    <p class="muted"><a href="/specimens?limit=${limit}&offset=${Math.max(0, offset - limit)}">&larr; prev</a> · <a href="/specimens?limit=${limit}&offset=${offset + limit}">next &rarr;</a> · <a href="/export.csv?table=specimens">download CSV</a></p>
  `;
  return html(layout({ title: "Specimens", body, active: "/specimens" }));
}

async function routeSpecimenById(sql, id, wantsHtml) {
  const rows = await sql`SELECT * FROM specimens WHERE id = ${id}`;
  if (rows.length === 0) {
    return wantsHtml
      ? html(layout({ title: "Not found", body: `<h1>Specimen not found</h1><p>No specimen with id <code>${escapeHtml(id)}</code>.</p>`, active: "/specimens" }), { status: 404 })
      : json({ error: "not_found", id }, { status: 404 });
  }
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
  const comparisons = await sql`
    SELECT c.*, ps.id AS other_id, ps.common_name AS other_name, ps.taxonomic_assignment AS other_taxon
    FROM specimen_comparisons c
    JOIN specimens ps ON ps.id = CASE WHEN c.specimen_a_id = ${id} THEN c.specimen_b_id ELSE c.specimen_a_id END
    WHERE c.specimen_a_id = ${id} OR c.specimen_b_id = ${id}
    ORDER BY c.publication_id, c.comparison_type
  `;

  if (!wantsHtml) return json({ version: VERSION, specimen: spec, site, analyses, comparisons });

  const analysisRows = analyses.map((a) => `
    <tr>
      <td><code>${escapeHtml(a.method ?? "")}</code></td>
      <td>${escapeHtml(a.result_summary ?? "")}${a.result_summary_source_quote ? `<div class="quote">${escapeHtml(a.result_summary_source_quote)}</div>` : ""}</td>
      <td><a href="/publications/${encodeURIComponent(a.publication_id)}"><code>${escapeHtml(a.publication_id)}</code></a></td>
      <td>${verifPill(a.verification_state)}</td>
    </tr>`).join("");

  const compRows = comparisons.map((c) => `
    <tr>
      <td><a href="/specimens/${encodeURIComponent(c.other_id)}">${escapeHtml(c.other_name ?? c.other_id)}</a> <span class="muted">(${escapeHtml(c.other_taxon ?? "?")})</span></td>
      <td><code>${escapeHtml(c.comparison_type)}</code></td>
      <td>${escapeHtml(c.claim)}${c.claim_source_quote ? `<div class="quote">${escapeHtml(c.claim_source_quote)}</div>` : ""}</td>
      <td><a href="/publications/${encodeURIComponent(c.publication_id)}"><code>${escapeHtml(c.publication_id)}</code></a></td>
      <td>${verifPill(c.verification_state)}</td>
    </tr>`).join("");

  const body = `
<h1>${escapeHtml(spec.common_name ?? spec.id)}</h1>
<p>${verifPill(spec.verification_state)} <code>${escapeHtml(spec.id)}</code>${spec.catalog_number ? ` · catalog <code>${escapeHtml(spec.catalog_number)}</code>` : ""}</p>

<dl class="grid">
  <dt>Taxonomic assignment</dt><dd><strong>${escapeHtml(spec.taxonomic_assignment ?? "unassigned")}</strong></dd>
  <dt>Assignment method</dt><dd>${escapeHtml(spec.assignment_method ?? "—")}</dd>
  <dt>Assignment publication</dt><dd>${spec.assignment_publication ? `<a href="/publications/${encodeURIComponent(spec.assignment_publication)}"><code>${escapeHtml(spec.assignment_publication)}</code></a>` : "—"}</dd>
  <dt>Provenance publication</dt><dd>${spec.provenance_publication ? `<a href="/publications/${encodeURIComponent(spec.provenance_publication)}"><code>${escapeHtml(spec.provenance_publication)}</code></a>` : "—"}</dd>
  <dt>Material</dt><dd>${escapeHtml(spec.material_type ?? "—")}</dd>
  <dt>Site</dt><dd>${site ? `<a href="/sites/${encodeURIComponent(site.id)}">${escapeHtml(site.name)}</a> <span class="muted">(${escapeHtml(site.country ?? "?")})</span>` : "—"}</dd>
  <dt>Current custody</dt><dd>${escapeHtml(spec.current_custody ?? "—")}</dd>
</dl>

${spec.taxonomic_assignment_source_quote ? `<h2>Source quote (assignment)</h2><div class="quote">${escapeHtml(spec.taxonomic_assignment_source_quote)}</div>` : ""}

<h2>Analyses (${analyses.length})</h2>
${analyses.length ? `<table><thead><tr><th>Method</th><th>Result</th><th>Publication</th><th>State</th></tr></thead><tbody>${analysisRows}</tbody></table>` : `<p class="muted">No published analyses yet.</p>`}

<h2>Comparisons (${comparisons.length})</h2>
${comparisons.length ? `<table><thead><tr><th>Related to</th><th>Type</th><th>Claim</th><th>Publication</th><th>State</th></tr></thead><tbody>${compRows}</tbody></table>` : `<p class="muted">No cross-specimen comparison claims recorded yet.</p>`}

<h2>Provenance graph</h2>
<p><a href="/graph/${encodeURIComponent(spec.id)}">Specimen → papers → site → related specimens</a> (JSON)</p>

<p class="muted" style="margin-top:1.5rem">JSON: <a href="/specimens/${encodeURIComponent(spec.id)}.json">/specimens/${escapeHtml(spec.id)}.json</a></p>
`;
  return html(layout({ title: spec.common_name ?? spec.id, body, active: "/specimens" }));
}

async function routeSites(sql, url) {
  const { limit, offset } = parsePaging(url);
  const total = (await sql`SELECT COUNT(*)::int AS n FROM sites`)[0].n;
  const rows = await sql`
    SELECT s.*, (SELECT COUNT(*)::int FROM specimens sp WHERE sp.site_id = s.id) AS specimen_count
    FROM sites s ORDER BY s.id LIMIT ${limit} OFFSET ${offset}
  `;
  return json({ version: VERSION, ...pageMeta(limit, offset, rows.length, total), sites: rows });
}

async function routeSiteById(sql, id, wantsHtml) {
  const rows = await sql`SELECT * FROM sites WHERE id = ${id}`;
  if (rows.length === 0) {
    return wantsHtml
      ? html(layout({ title: "Not found", body: `<h1>Site not found</h1><p>No site with id <code>${escapeHtml(id)}</code>.</p>`, active: "/sites" }), { status: 404 })
      : json({ error: "not_found", id }, { status: 404 });
  }
  const site = rows[0];
  const specimens = await sql`
    SELECT id, common_name, taxonomic_assignment, assignment_method, verification_state
    FROM specimens WHERE site_id = ${id} ORDER BY id
  `;
  if (!wantsHtml) return json({ version: VERSION, site, specimens });

  const specRows = specimens.map((s) => `
    <tr>
      <td><a href="/specimens/${encodeURIComponent(s.id)}">${escapeHtml(s.common_name ?? s.id)}</a></td>
      <td>${escapeHtml(s.taxonomic_assignment ?? "unassigned")}</td>
      <td>${escapeHtml(s.assignment_method ?? "—")}</td>
      <td>${verifPill(s.verification_state)}</td>
    </tr>`).join("");

  const body = `
<h1>${escapeHtml(site.name)}</h1>
<p>${verifPill(site.verification_state)} <code>${escapeHtml(site.id)}</code></p>
<dl class="grid">
  <dt>Country</dt><dd>${escapeHtml(site.country ?? "—")}</dd>
  <dt>Region</dt><dd>${escapeHtml(site.region ?? "—")}</dd>
  <dt>Coordinates</dt><dd>${site.latitude ?? "—"}${site.longitude ? `, ${site.longitude}` : ""}</dd>
  <dt>Site type</dt><dd>${escapeHtml(site.site_type ?? "—")}</dd>
</dl>
<h2>Specimens from this site (${specimens.length})</h2>
${specimens.length ? `<table><thead><tr><th>Specimen</th><th>Taxonomic assignment</th><th>Method</th><th>State</th></tr></thead><tbody>${specRows}</tbody></table>` : `<p class="muted">No specimens recorded.</p>`}
`;
  return html(layout({ title: site.name, body, active: "/sites" }));
}

async function routePublications(sql, url, wantsHtml) {
  const yearFilter = parseInt(url.searchParams.get("year") || "", 10);
  const yearMin = parseInt(url.searchParams.get("year_min") || "", 10);
  const yearMax = parseInt(url.searchParams.get("year_max") || "", 10);
  const useYear = !isNaN(yearFilter);
  const useRange = !isNaN(yearMin) || !isNaN(yearMax);
  const { limit, offset } = parsePaging(url);
  let total, rows;
  if (useYear) {
    total = (await sql`SELECT COUNT(*)::int AS n FROM publications WHERE year = ${yearFilter}`)[0].n;
    rows = await sql`SELECT id, title, authors, year, journal, verification_state FROM publications WHERE year = ${yearFilter} ORDER BY year DESC, id LIMIT ${limit} OFFSET ${offset}`;
  } else if (useRange) {
    const lo = isNaN(yearMin) ? 1900 : yearMin;
    const hi = isNaN(yearMax) ? 2100 : yearMax;
    total = (await sql`SELECT COUNT(*)::int AS n FROM publications WHERE year >= ${lo} AND year <= ${hi}`)[0].n;
    rows = await sql`SELECT id, title, authors, year, journal, verification_state FROM publications WHERE year >= ${lo} AND year <= ${hi} ORDER BY year DESC, id LIMIT ${limit} OFFSET ${offset}`;
  } else {
    total = (await sql`SELECT COUNT(*)::int AS n FROM publications`)[0].n;
    rows = await sql`
    SELECT id, title, year, journal, authors, verification_state,
           (SELECT COUNT(*)::int FROM analyses a WHERE a.publication_id = p.id) AS analysis_count,
           (SELECT COUNT(*)::int FROM specimens s WHERE s.assignment_publication = p.id OR s.provenance_publication = p.id) AS specimen_count
    FROM publications p ORDER BY year DESC, id LIMIT ${limit} OFFSET ${offset}
  `;
  }
  const filter = useYear ? { year: yearFilter } : useRange ? { year_min: isNaN(yearMin) ? null : yearMin, year_max: isNaN(yearMax) ? null : yearMax } : null;
  if (!wantsHtml) return json({ version: VERSION, filter, ...pageMeta(limit, offset, rows.length, total), publications: rows });
  const filterLabel = useYear ? ` in ${yearFilter}` : useRange ? ` (${isNaN(yearMin) ? "≤" : yearMin + "–"}${isNaN(yearMax) ? "today" : yearMax})` : "";
  const body = `
    <h1>Publications${filterLabel}</h1>
    <p class="muted">${total} total · showing ${rows.length} (offset ${offset}, limit ${limit}) · filter by <a href="/publications?year=1997">?year=YYYY</a> or <a href="/publications?year_min=2018&year_max=2020">?year_min=YYYY&amp;year_max=YYYY</a></p>
    <table>
      <thead><tr><th>DOI</th><th>Title</th><th>Year</th><th>Journal</th><th>State</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><a href="/publications/${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a></td><td>${escapeHtml((r.title || "").slice(0, 100))}</td><td>${r.year || ""}</td><td>${escapeHtml(r.journal || "")}</td><td><span class="chip chip-${escapeHtml(r.verification_state)}">${escapeHtml(r.verification_state)}</span></td></tr>`).join("")}</tbody>
    </table>
    <p class="muted"><a href="/publications?limit=${limit}&offset=${Math.max(0, offset - limit)}${useYear ? "&year=" + yearFilter : ""}">&larr; prev</a> · <a href="/publications?limit=${limit}&offset=${offset + limit}${useYear ? "&year=" + yearFilter : ""}">next &rarr;</a> · <a href="/export.csv?table=publications">download CSV</a></p>
  `;
  return html(layout({ title: "Publications", body, active: "/publications" }));
}

async function routePublicationById(sql, id, wantsHtml) {
  const rows = await sql`SELECT * FROM publications WHERE id = ${id}`;
  if (rows.length === 0) {
    return wantsHtml
      ? html(layout({ title: "Not found", body: `<h1>Publication not found</h1><p>No publication with id <code>${escapeHtml(id)}</code>.</p>`, active: "/publications" }), { status: 404 })
      : json({ error: "not_found", id }, { status: 404 });
  }
  const pub = rows[0];
  if (pub.verification_notes && pub.verification_notes.includes("---RAW MARKDOWN---")) {
    pub.verification_notes = pub.verification_notes.split("---RAW MARKDOWN---")[0].trim();
  }
  const specimens = await sql`
    SELECT id, common_name, taxonomic_assignment, assignment_method, verification_state
    FROM specimens WHERE assignment_publication = ${id} OR provenance_publication = ${id} ORDER BY id
  `;
  const analyses = await sql`
    SELECT id, specimen_id, method, dating_method, lab, result_summary, verification_state
    FROM analyses WHERE publication_id = ${id} ORDER BY specimen_id, method
  `;
  if (!wantsHtml) return json({ version: VERSION, publication: pub, specimens, analyses });

  const authorLine = Array.isArray(pub.authors) ? pub.authors.slice(0, 6).join(", ") + (pub.authors.length > 6 ? `, et al. (${pub.authors.length} authors)` : "") : "";
  const specRows = specimens.map((s) => `
    <tr>
      <td><a href="/specimens/${encodeURIComponent(s.id)}">${escapeHtml(s.common_name ?? s.id)}</a></td>
      <td>${escapeHtml(s.taxonomic_assignment ?? "unassigned")}</td>
      <td>${verifPill(s.verification_state)}</td>
    </tr>`).join("");
  const anRows = analyses.map((a) => `
    <tr>
      <td><a href="/specimens/${encodeURIComponent(a.specimen_id)}"><code>${escapeHtml(a.specimen_id)}</code></a></td>
      <td><code>${escapeHtml(a.method ?? "")}</code></td>
      <td>${escapeHtml(a.result_summary ?? "")}</td>
      <td>${verifPill(a.verification_state)}</td>
    </tr>`).join("");

  const body = `
<h1>${escapeHtml(pub.title ?? pub.id)}</h1>
<p>${verifPill(pub.verification_state)} <code>${escapeHtml(pub.id)}</code></p>
<dl class="grid">
  <dt>Year</dt><dd>${pub.year ?? "—"}</dd>
  <dt>Journal</dt><dd>${escapeHtml(pub.journal ?? "—")}${pub.volume ? `, ${escapeHtml(pub.volume)}` : ""}${pub.issue ? `(${escapeHtml(pub.issue)})` : ""}${pub.pages ? ` ${escapeHtml(pub.pages)}` : ""}</dd>
  <dt>Authors</dt><dd>${escapeHtml(authorLine)}</dd>
  <dt>DOI / URL</dt><dd>${pub.open_access_url ? `<a href="${escapeHtml(pub.open_access_url)}">${escapeHtml(pub.open_access_url)}</a>` : "—"}</dd>
</dl>

${pub.abstract ? `<h2>Abstract</h2><p>${escapeHtml(pub.abstract)}</p>` : ""}

<h2>Specimens referenced (${specimens.length})</h2>
${specimens.length ? `<table><thead><tr><th>Specimen</th><th>Taxonomic assignment</th><th>State</th></tr></thead><tbody>${specRows}</tbody></table>` : `<p class="muted">No specimens attached.</p>`}

<h2>Analyses in this publication (${analyses.length})</h2>
${analyses.length ? `<table><thead><tr><th>Specimen</th><th>Method</th><th>Result summary</th><th>State</th></tr></thead><tbody>${anRows}</tbody></table>` : `<p class="muted">No structured analyses recorded.</p>`}
`;
  return html(layout({ title: pub.title ?? pub.id, body, active: "/publications" }));
}

async function routeAnalyses(sql, url) {
  const spec = url.searchParams.get("specimen_id");
  const pub = url.searchParams.get("publication_id");
  const { limit, offset } = parsePaging(url);
  let rows, total;
  if (spec) {
    total = (await sql`SELECT COUNT(*)::int AS n FROM analyses WHERE specimen_id = ${spec}`)[0].n;
    rows = await sql`SELECT * FROM analyses WHERE specimen_id = ${spec} ORDER BY publication_id, method LIMIT ${limit} OFFSET ${offset}`;
  } else if (pub) {
    total = (await sql`SELECT COUNT(*)::int AS n FROM analyses WHERE publication_id = ${pub}`)[0].n;
    rows = await sql`SELECT * FROM analyses WHERE publication_id = ${pub} ORDER BY specimen_id, method LIMIT ${limit} OFFSET ${offset}`;
  } else {
    total = (await sql`SELECT COUNT(*)::int AS n FROM analyses`)[0].n;
    rows = await sql`SELECT * FROM analyses ORDER BY specimen_id, publication_id, method LIMIT ${limit} OFFSET ${offset}`;
  }
  return json({ version: VERSION, filter: spec ? { specimen_id: spec } : pub ? { publication_id: pub } : null, ...pageMeta(limit, offset, rows.length, total), analyses: rows });
}

function routeOpenAPI() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Specimen Registry (SAR) API",
      version: VERSION,
      description: "Public read-only registry of archaic hominin (and select ancient modern human) specimens, publications, sites, analyses, and cross-specimen comparisons. Every row carries a verification_state (draft | pending-verification | source-locked) and every material claim is source-quoted verbatim from primary literature. Data licensed under CC BY 4.0.",
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/legalcode" },
      contact: { name: "Michael Gonzalez", url: "https://specimenregistry.org/license" },
    },
    servers: [{ url: "https://specimenregistry.org" }],
    paths: {
      "/health": { get: { summary: "Liveness probe", responses: { "200": { description: "ok" } } } },
      "/version": { get: { summary: "Service version and capability set", responses: { "200": { description: "version JSON" } } } },
      "/license": { get: { summary: "CC BY 4.0 attribution disclosure", responses: { "200": { description: "license JSON or HTML" } } } },
      "/stats": { get: { summary: "Corpus rollups: totals + specimens by state/site + pubs by year", responses: { "200": { description: "stats JSON" } } } },
      "/timeline": { get: { summary: "Specimens with their earliest describing publication, ordered by publication year", responses: { "200": { description: "timeline JSON" } } } },
      "/random": { get: { summary: "Random specimen. HTML mode 302-redirects to /specimens/:id; JSON mode returns the specimen row.", responses: { "200": { description: "random specimen JSON" }, "302": { description: "redirect to specimen detail" } } } },
      "/audit": { get: { summary: "Recent access log entries (last N=20 default, max 100). Only public routes; IPs are one-way hashed.", parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }], responses: { "200": { description: "audit JSON" } } } },
      "/methods": { get: { summary: "Distinct assignment methods (how specimens were taxonomically assigned) and analysis types (techniques applied in individual papers), with counts.", responses: { "200": { description: "methods JSON" } } } },
      "/related/{id}": { get: { summary: "Neighbor specimens across three relatedness surfaces: shared publication, same site, and specimen_comparisons row.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "related JSON" }, "404": { description: "specimen not found" } } } },
      "/export.csv": { get: { summary: "Bulk CSV export. Provide ?table=publications or ?table=specimens (default: specimens).", parameters: [{ name: "table", in: "query", schema: { type: "string", enum: ["publications", "specimens", "analyses", "comparisons"], default: "specimens" } }], responses: { "200": { description: "CSV body" } } } },
      "/publications": { get: { summary: "List publications (paginated)", parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 25, maximum: 100 } }, { name: "offset", in: "query", schema: { type: "integer", default: 0 } }], responses: { "200": { description: "publications JSON" } } } },
      "/publications/{doi}": { get: { summary: "Single publication by DOI", parameters: [{ name: "doi", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "publication JSON or HTML" } } } },
      "/specimens": { get: { summary: "List specimens (paginated)", parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 25, maximum: 100 } }, { name: "offset", in: "query", schema: { type: "integer", default: 0 } }, { name: "site_id", in: "query", schema: { type: "string" } }], responses: { "200": { description: "specimens JSON" } } } },
      "/specimens/{id}": { get: { summary: "Single specimen by ID", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "specimen JSON or HTML" } } } },
      "/sites": { get: { summary: "List sites", responses: { "200": { description: "sites JSON" } } } },
      "/sites/{id}": { get: { summary: "Single site by ID", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "site JSON or HTML" } } } },
      "/analyses": { get: { summary: "List analyses (filter by specimen_id or publication_id)", parameters: [{ name: "specimen_id", in: "query", schema: { type: "string" } }, { name: "publication_id", in: "query", schema: { type: "string" } }], responses: { "200": { description: "analyses JSON" } } } },
      "/comparisons": { get: { summary: "List cross-specimen comparison rows", parameters: [{ name: "specimen_id", in: "query", schema: { type: "string" } }, { name: "publication_id", in: "query", schema: { type: "string" } }, { name: "type", in: "query", schema: { type: "string", enum: ["genome-relatedness", "sister-lineage", "introgression-source", "related-population", "kin-relationship", "contemporaneous"] } }], responses: { "200": { description: "comparisons JSON or HTML" } } } },
      "/graph/{specimen_id}": { get: { summary: "Provenance chain: specimen → papers → site → related specimens", parameters: [{ name: "specimen_id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "nodes + edges JSON" } } } },
      "/search": { get: { summary: "Full-text search over publications + specimens", parameters: [{ name: "q", in: "query", schema: { type: "string" } }, { name: "type", in: "query", schema: { type: "string", enum: ["publication", "specimen", "all"] } }], responses: { "200": { description: "search JSON or HTML" } } } },
    },
    components: {
      schemas: {
        VerificationState: { type: "string", enum: ["draft", "pending-verification", "source-locked"], description: "Human-review state on a row. Only source-locked rows are safe to cite; draft/pending-verification await Michael Gonzalez's primary-source sign-off." },
      },
    },
  };
  return json(spec);
}

async function routeTimeline(sql, wantsHtml) {
  const rows = await sql`
    SELECT sp.id AS specimen_id, sp.common_name, sp.taxonomic_assignment, sp.site_id,
           s.name AS site_name,
           MIN(p.year) AS earliest_year,
           ARRAY_AGG(DISTINCT p.id ORDER BY p.id) AS publication_ids
    FROM specimens sp
    LEFT JOIN sites s ON s.id = sp.site_id
    LEFT JOIN analyses a ON a.specimen_id = sp.id
    LEFT JOIN publications p ON p.id = a.publication_id
    GROUP BY sp.id, sp.common_name, sp.taxonomic_assignment, sp.site_id, s.name
    ORDER BY MIN(p.year) NULLS LAST, sp.id
  `;
  if (!wantsHtml) {
    return json({
      version: VERSION,
      count: rows.length,
      timeline: rows,
      note: "earliest_year = MIN(publication.year) of any analysis linking to the specimen. Specimens with no analysis link are ordered last (year=null).",
    });
  }
  const trs = rows.map((r) => {
    const pubs = (r.publication_ids || []).map((p) => p ? `<a href="/publications/${encodeURIComponent(p)}">${escapeHtml(p)}</a>` : "").filter(Boolean).join("<br>");
    return `<tr>
      <td>${r.earliest_year ?? "—"}</td>
      <td><a href="/specimens/${encodeURIComponent(r.specimen_id)}">${escapeHtml(r.specimen_id)}</a></td>
      <td>${escapeHtml(r.common_name || "")}</td>
      <td>${escapeHtml(r.taxonomic_assignment || "")}</td>
      <td>${r.site_id ? `<a href="/sites/${encodeURIComponent(r.site_id)}">${escapeHtml(r.site_name || r.site_id)}</a>` : "—"}</td>
      <td>${pubs || "—"}</td>
    </tr>`;
  }).join("");
  // Build a decade-density histogram for the visual chart above the table.
  const validYears = rows.map(r => r.earliest_year).filter(y => y != null);
  const nullCount = rows.length - validYears.length;
  let densityHtml = "";
  if (validYears.length > 0) {
    const minY = Math.min(...validYears);
    const maxY = Math.max(...validYears);
    const minDecade = Math.floor(minY / 10) * 10;
    const maxDecade = Math.floor(maxY / 10) * 10;
    const buckets = {};
    for (let d = minDecade; d <= maxDecade; d += 10) buckets[d] = 0;
    for (const y of validYears) buckets[Math.floor(y / 10) * 10]++;
    const maxBucket = Math.max(...Object.values(buckets), 1);
    const bars = Object.entries(buckets).map(([dec, n]) => {
      const pct = Math.round((n / maxBucket) * 100);
      return `<div style="display:flex;align-items:center;gap:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px">
        <span style="width:56px;color:#666">${dec}s</span>
        <span style="flex:1;background:#eee;height:14px;border-radius:2px;overflow:hidden">
          <span style="display:block;width:${pct}%;height:100%;background:${n === 0 ? 'transparent' : '#4a7dbf'}"></span>
        </span>
        <span style="width:32px;text-align:right;color:${n === 0 ? '#bbb' : '#333'}">${n}</span>
      </div>`;
    }).join("");
    densityHtml = `<h2>Specimens by publication decade</h2>
<p class="muted" style="font-size:13px">Decade-bucketed count of the earliest describing publication for each specimen. ${validYears.length} specimens with a linked publication year; ${nullCount} without.</p>
<div style="max-width:640px;margin:8px 0 20px">${bars}</div>`;
  }
  const body = `<h1>Timeline</h1>
<p>${rows.length} specimens ordered by earliest describing publication year. Specimens with no analysis link are last.</p>
${densityHtml}
<h2>Full table</h2>
<table><thead><tr><th>Year</th><th>Specimen</th><th>Common name</th><th>Taxon</th><th>Site</th><th>Publications</th></tr></thead>
<tbody>${trs}</tbody></table>
<p><a href="/timeline" onclick="event.preventDefault();fetch('/timeline',{headers:{accept:'application/json'}}).then(r=>r.json()).then(d=>alert(JSON.stringify(d,null,2)))">View as JSON</a> · <a href="/openapi">API spec</a></p>`;
  return html(layout({ title: "Timeline · SAR", body, active: "/timeline" }));
}

async function routeRandom(sql, wantsHtml) {
  const rows = await sql`
    SELECT sp.id AS specimen_id, sp.common_name, sp.taxonomic_assignment, sp.site_id, s.name AS site_name
    FROM specimens sp
    LEFT JOIN sites s ON s.id = sp.site_id
    ORDER BY random()
    LIMIT 1
  `;
  if (rows.length === 0) {
    if (!wantsHtml) return json({ error: "empty corpus" }, { status: 404 });
    return html(layout({ title: "Random · SAR", body: "<h1>Empty corpus</h1>", active: "/" }), { status: 404 });
  }
  const r = rows[0];
  if (!wantsHtml) {
    return json({
      specimen_id: r.specimen_id,
      common_name: r.common_name,
      taxonomic_assignment: r.taxonomic_assignment,
      site_id: r.site_id,
      site_name: r.site_name,
      redirect_html: `/specimens/${encodeURIComponent(r.specimen_id)}`,
      note: "A random specimen from the corpus. Refresh /random to draw another.",
    });
  }
  // HTML mode: redirect to the specimen detail page
  return new Response(null, {
    status: 302,
    headers: { location: `/specimens/${encodeURIComponent(r.specimen_id)}` },
  });
}

async function routeAudit(sql, url, wantsHtml) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);
  const rows = await sql`
    SELECT ts, method, path, status, duration_ms, ip_hash, ua AS user_agent, ray_id
    FROM access_log
    ORDER BY ts DESC
    LIMIT ${limit}
  `;
  if (!wantsHtml) {
    return json({
      version: VERSION,
      count: rows.length,
      limit,
      audit: rows,
      note: "IPs are one-way hashed with a rotating salt; no reverse lookup possible. User-Agent may be null for programmatic clients. This endpoint itself is included in the log.",
    });
  }
  const trs = rows.map((r) => {
    const statusClass = r.status >= 500 ? "err" : r.status >= 400 ? "warn" : "ok";
    return `<tr>
      <td class="mono">${escapeHtml(String(r.ts))}</td>
      <td>${escapeHtml(r.method || "")}</td>
      <td class="mono"><a href="${escapeHtml(r.path || "")}">${escapeHtml(r.path || "")}</a></td>
      <td class="${statusClass}">${r.status ?? ""}</td>
      <td>${r.duration_ms ?? ""}ms</td>
      <td class="mono" style="opacity:0.6">${escapeHtml((r.ip_hash || "").slice(0, 12))}${(r.ip_hash || "").length > 12 ? "…" : ""}</td>
      <td>${escapeHtml((r.user_agent || "").slice(0, 60))}${(r.user_agent || "").length > 60 ? "…" : ""}</td>
    </tr>`;
  }).join("");
  const body = `<h1>Access audit</h1>
<p>Last ${rows.length} requests (limit=${limit}, max=100). IPs are one-way hashed with a rotating salt; no reverse lookup possible. User-Agent truncated to 60 chars for display.</p>
<p><a href="/audit?limit=50">50</a> · <a href="/audit?limit=100">100</a></p>
<style>.ok{color:#080}.warn{color:#c60}.err{color:#c00;font-weight:bold}.mono{font-family:ui-monospace,monospace;font-size:0.85em}</style>
<table><thead><tr><th>Timestamp</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>IP hash</th><th>User-Agent</th></tr></thead>
<tbody>${trs}</tbody></table>
<p><a href="/audit?limit=${limit}" onclick="event.preventDefault();fetch('/audit?limit=${limit}',{headers:{accept:'application/json'}}).then(r=>r.json()).then(d=>alert(JSON.stringify(d,null,2)))">View as JSON</a> · <a href="/openapi">API spec</a></p>`;
  return html(layout({ title: "Audit · SAR", body, active: "/audit" }));
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function routeExportCsv(sql, url) {
  const table = (url.searchParams.get("table") || "specimens").toLowerCase();
  let rows, headers;
  if (table === "publications") {
    rows = await sql`SELECT id, title, authors, year, journal, publication_date, open_access_url, verification_state FROM publications ORDER BY year DESC, id`;
    headers = ["id", "title", "authors", "year", "journal", "publication_date", "open_access_url", "verification_state"];
  } else if (table === "specimens") {
    rows = await sql`SELECT id, common_name, catalog_number, site_id, taxonomic_assignment, assignment_method, assignment_publication, verification_state FROM specimens ORDER BY id`;
    headers = ["id", "common_name", "catalog_number", "site_id", "taxonomic_assignment", "assignment_method", "assignment_publication", "verification_state"];
  } else if (table === "analyses") {
    rows = await sql`SELECT id, specimen_id, publication_id, method, dating_method, age_estimate_lower_ka, age_estimate_upper_ka, verification_state FROM analyses ORDER BY publication_id, specimen_id`;
    headers = ["id", "specimen_id", "publication_id", "method", "dating_method", "age_estimate_lower_ka", "age_estimate_upper_ka", "verification_state"];
  } else if (table === "comparisons") {
    rows = await sql`SELECT id, specimen_a_id, specimen_b_id, comparison_type, method, publication_id, verification_state FROM specimen_comparisons ORDER BY id`;
    headers = ["id", "specimen_a_id", "specimen_b_id", "comparison_type", "method", "publication_id", "verification_state"];
  } else {
    return json({ error: "bad_request", message: "table must be one of: publications, specimens, analyses, comparisons", provided: table }, { status: 400 });
  }
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => csvEscape(r[h])).join(","));
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sar_${table}.csv"`,
      "x-sar-version": VERSION,
      "x-sar-row-count": String(rows.length),
      "cache-control": "public, max-age=60",
    },
  });
}

async function routeRelated(sql, specimenId) {
  const [spec] = await sql`SELECT id, common_name, taxonomic_assignment, site_id FROM specimens WHERE id = ${specimenId}`;
  if (!spec) return json({ error: "not_found", specimen_id: specimenId }, { status: 404 });

  // Neighbors via shared analyses (same publication)
  const viaShared = await sql`
    SELECT DISTINCT sp2.id, sp2.common_name, sp2.taxonomic_assignment, sp2.site_id,
           ARRAY_AGG(DISTINCT a2.publication_id ORDER BY a2.publication_id) AS shared_publications
    FROM analyses a1
    JOIN analyses a2 ON a2.publication_id = a1.publication_id AND a2.specimen_id <> a1.specimen_id
    JOIN specimens sp2 ON sp2.id = a2.specimen_id
    WHERE a1.specimen_id = ${specimenId}
    GROUP BY sp2.id, sp2.common_name, sp2.taxonomic_assignment, sp2.site_id
    ORDER BY sp2.id
  `;

  // Neighbors via same site
  const viaSite = await sql`
    SELECT sp.id, sp.common_name, sp.taxonomic_assignment, sp.site_id
    FROM specimens sp
    WHERE sp.site_id = ${spec.site_id} AND sp.id <> ${specimenId}
    ORDER BY sp.id
  `;

  // Neighbors via specimen_comparisons
  const viaComparisons = await sql`
    SELECT DISTINCT sp.id, sp.common_name, sp.taxonomic_assignment, sp.site_id,
           ARRAY_AGG(DISTINCT sc.comparison_type ORDER BY sc.comparison_type) AS comparison_types,
           ARRAY_AGG(DISTINCT sc.publication_id ORDER BY sc.publication_id) AS via_publications
    FROM specimen_comparisons sc
    JOIN specimens sp ON sp.id = CASE WHEN sc.specimen_a_id = ${specimenId} THEN sc.specimen_b_id ELSE sc.specimen_a_id END
    WHERE sc.specimen_a_id = ${specimenId} OR sc.specimen_b_id = ${specimenId}
    GROUP BY sp.id, sp.common_name, sp.taxonomic_assignment, sp.site_id
    ORDER BY sp.id
  `;

  return json({
    version: VERSION,
    specimen: spec,
    related: {
      via_shared_publication: viaShared,
      via_same_site: viaSite,
      via_comparison: viaComparisons,
    },
    counts: {
      via_shared_publication: viaShared.length,
      via_same_site: viaSite.length,
      via_comparison: viaComparisons.length,
    },
    note: "Three relatedness surfaces: (a) specimens co-analysed in the same publication, (b) other specimens from the same site, (c) specimens linked via a specimen_comparisons row. A single specimen can appear in multiple surfaces.",
  });
}

async function routeMethods(sql, wantsHtml) {
  const assignmentMethods = await sql`
    SELECT assignment_method AS method,
           COUNT(*)::int AS specimen_count,
           ARRAY_AGG(DISTINCT verification_state ORDER BY verification_state) AS verification_states
    FROM specimens
    WHERE assignment_method IS NOT NULL
    GROUP BY assignment_method
    ORDER BY specimen_count DESC, assignment_method
  `;
  const analysisTypes = await sql`
    SELECT method AS method,
           COUNT(*)::int AS analysis_count,
           COUNT(DISTINCT specimen_id)::int AS specimen_count,
           COUNT(DISTINCT publication_id)::int AS publication_count
    FROM analyses
    WHERE method IS NOT NULL
    GROUP BY method
    ORDER BY analysis_count DESC, method
  `;
  if (!wantsHtml) {
    return json({
      version: VERSION,
      assignment_methods: assignmentMethods,
      analysis_types: analysisTypes,
      note: "assignment_method reflects how a specimen was taxonomically assigned. analysis_type reflects the technique used in an individual paper's analysis. A single specimen typically has one assignment_method but multiple analyses across papers.",
    });
  }
  const parseArr = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.startsWith("{") && v.endsWith("}")) return v.slice(1, -1).split(",").filter(Boolean);
    return [];
  };
  const trsAssign = assignmentMethods.map(m => `<tr><td>${escapeHtml(m.method)}</td><td>${m.specimen_count}</td><td>${parseArr(m.verification_states).map(v => `<code>${escapeHtml(v)}</code>`).join(" ")}</td></tr>`).join("");
  const trsAnal = analysisTypes.map(m => `<tr><td>${escapeHtml(m.method)}</td><td>${m.analysis_count}</td><td>${m.specimen_count}</td><td>${m.publication_count}</td></tr>`).join("");
  const body = `<h1>Methods</h1>
<p><b>assignment_method</b> = how a specimen was taxonomically assigned. <b>analysis type</b> = the technique used in an individual paper's analysis. A specimen typically has one assignment_method but appears in multiple analyses across papers.</p>
<h2>Assignment methods (specimen-level)</h2>
<table><thead><tr><th>Method</th><th># specimens</th><th>Verification states</th></tr></thead>
<tbody>${trsAssign}</tbody></table>
<h2>Analysis types (paper-level)</h2>
<table><thead><tr><th>Method</th><th># analyses</th><th># specimens</th><th># publications</th></tr></thead>
<tbody>${trsAnal}</tbody></table>
<p><a href="/methods" onclick="event.preventDefault();fetch('/methods',{headers:{accept:'application/json'}}).then(r=>r.json()).then(d=>alert(JSON.stringify(d,null,2)))">View as JSON</a> · <a href="/openapi">API spec</a></p>`;
  return html(layout({ title: "Methods · SAR", body, active: "/methods" }));
}

async function routeStats(sql, wantsHtml) {
  const [pubs] = await sql`SELECT COUNT(*)::int AS c FROM publications`;
  const [specs] = await sql`SELECT COUNT(*)::int AS c FROM specimens`;
  const [sites] = await sql`SELECT COUNT(*)::int AS c FROM sites`;
  const [anals] = await sql`SELECT COUNT(*)::int AS c FROM analyses`;
  const [comps] = await sql`SELECT COUNT(*)::int AS c FROM specimen_comparisons`;
  const byState = await sql`
    SELECT verification_state, COUNT(*)::int AS c
    FROM specimens
    GROUP BY verification_state
    ORDER BY verification_state
  `;
  const bySite = await sql`
    SELECT s.id AS site_id, s.name AS site_name, COUNT(sp.id)::int AS specimen_count
    FROM sites s
    LEFT JOIN specimens sp ON sp.site_id = s.id
    GROUP BY s.id, s.name
    ORDER BY specimen_count DESC, s.id
  `;
  const byYear = await sql`
    SELECT year, COUNT(*)::int AS c
    FROM publications
    WHERE year IS NOT NULL
    GROUP BY year
    ORDER BY year
  `;
  if (!wantsHtml) {
    return json({
      totals: {
        publications: pubs.c,
        specimens: specs.c,
        sites: sites.c,
        analyses: anals.c,
        comparisons: comps.c,
      },
      specimens_by_verification_state: byState,
      specimens_by_site: bySite,
      publications_by_year: byYear,
      note: "All specimens in this pilot are in `draft` or `pending-verification` state until Michael Gonzalez signs off on primary-source review.",
    });
  }
  const stateRows = byState.map((r) => `<tr><td>${escapeHtml(r.verification_state)}</td><td style="text-align:right">${r.c}</td></tr>`).join("");
  const siteRows = bySite.map((r) => `<tr><td><a href="/sites/${encodeURIComponent(r.site_id)}">${escapeHtml(r.site_name || r.site_id)}</a></td><td style="text-align:right">${r.specimen_count}</td></tr>`).join("");
  const yearRows = byYear.map((r) => `<tr><td>${r.year}</td><td style="text-align:right">${r.c}</td></tr>`).join("");
  // SVG line chart for publications by year — fill zero-count years between min and max
  let yearChart = "";
  if (byYear.length >= 2) {
    const minYear = byYear[0].year;
    const maxYear = byYear[byYear.length - 1].year;
    const yearMap = new Map(byYear.map(r => [r.year, r.c]));
    const filled = [];
    for (let y = minYear; y <= maxYear; y++) filled.push({ year: y, c: yearMap.get(y) || 0 });
    const maxC = Math.max(...filled.map(r => r.c), 1);
    const w = 700, h = 220, padL = 40, padR = 10, padT = 20, padB = 30;
    const cw = w - padL - padR, ch = h - padT - padB;
    const xStep = filled.length > 1 ? cw / (filled.length - 1) : 0;
    const points = filled.map((r, i) => {
      const x = padL + i * xStep;
      const y = padT + ch - (r.c / maxC) * ch;
      return { x, y, year: r.year, c: r.c };
    });
    const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const dots = points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.c > 0 ? 3 : 1.5}" fill="${p.c > 0 ? '#4a7dbf' : '#ccc'}"><title>${p.year}: ${p.c}</title></circle>`).join("");
    // X-axis year labels at every ~5-year step
    const step = Math.max(1, Math.ceil(filled.length / 10));
    const xLabels = filled.map((r, i) => i % step === 0 ? `<text x="${(padL + i * xStep).toFixed(1)}" y="${h - padB + 14}" font-size="10" text-anchor="middle" fill="#666">${r.year}</text>` : "").join("");
    // Y-axis: 0 and max
    const yAxis = `<text x="${padL - 6}" y="${padT + 4}" font-size="10" text-anchor="end" fill="#666">${maxC}</text>
      <text x="${padL - 6}" y="${padT + ch + 4}" font-size="10" text-anchor="end" fill="#666">0</text>`;
    const axes = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ch}" stroke="#ccc"/>
      <line x1="${padL}" y1="${padT + ch}" x2="${padL + cw}" y2="${padT + ch}" stroke="#ccc"/>`;
    yearChart = `<h2>Publications-per-year chart</h2>
<p class="muted" style="font-size:13px">Line chart of publications grouped by publication year, ${minYear}–${maxYear}. Hover a dot for the exact count.</p>
<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;background:#fafafa;border:1px solid #eee;border-radius:3px">
${axes}
${yAxis}
<polyline points="${polyline}" fill="none" stroke="#4a7dbf" stroke-width="1.5"/>
${dots}
${xLabels}
</svg>`;
  }
  const body = `<h1>Corpus stats</h1>
<h2>Totals</h2>
<table><tbody>
<tr><td>Publications</td><td style="text-align:right"><strong>${pubs.c}</strong></td></tr>
<tr><td>Specimens</td><td style="text-align:right"><strong>${specs.c}</strong></td></tr>
<tr><td>Sites</td><td style="text-align:right"><strong>${sites.c}</strong></td></tr>
<tr><td>Analyses</td><td style="text-align:right"><strong>${anals.c}</strong></td></tr>
<tr><td>Comparisons</td><td style="text-align:right"><strong>${comps.c}</strong></td></tr>
</tbody></table>
<h2>Specimens by verification state</h2>
<table><thead><tr><th>State</th><th>Count</th></tr></thead><tbody>${stateRows}</tbody></table>
<p><small>No specimen is <code>source-locked</code> yet — that requires Michael's per-paper primary-source review.</small></p>
<h2>Specimens by site</h2>
<table><thead><tr><th>Site</th><th>Count</th></tr></thead><tbody>${siteRows}</tbody></table>
${yearChart}
<h2>Publications by year (table)</h2>
<table><thead><tr><th>Year</th><th>Count</th></tr></thead><tbody>${yearRows}</tbody></table>
<p><a href="/openapi">API spec</a> · <a href="/timeline">Timeline view</a></p>`;
  return html(layout({ title: "Stats · SAR", body, active: "/stats" }));
}

async function routeComparisons(sql, url, wantsHtml) {
  const specA = url.searchParams.get("specimen_id");
  const pub = url.searchParams.get("publication_id");
  const type = url.searchParams.get("type");
  const { limit, offset } = parsePaging(url);

  const whereClauses = [];
  const params = {};
  if (specA) { whereClauses.push("(specimen_a_id = ${a} OR specimen_b_id = ${a})"); params.a = specA; }
  if (pub) { whereClauses.push("publication_id = ${p}"); params.p = pub; }
  if (type) { whereClauses.push("comparison_type = ${t}"); params.t = type; }

  const rows = (specA && pub)
    ? await sql`SELECT * FROM specimen_comparisons WHERE (specimen_a_id = ${specA} OR specimen_b_id = ${specA}) AND publication_id = ${pub} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    : specA
    ? await sql`SELECT * FROM specimen_comparisons WHERE specimen_a_id = ${specA} OR specimen_b_id = ${specA} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    : pub
    ? await sql`SELECT * FROM specimen_comparisons WHERE publication_id = ${pub} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    : type
    ? await sql`SELECT * FROM specimen_comparisons WHERE comparison_type = ${type} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
    : await sql`SELECT * FROM specimen_comparisons ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;

  const total = (specA && pub)
    ? (await sql`SELECT COUNT(*)::int AS n FROM specimen_comparisons WHERE (specimen_a_id = ${specA} OR specimen_b_id = ${specA}) AND publication_id = ${pub}`)[0].n
    : specA
    ? (await sql`SELECT COUNT(*)::int AS n FROM specimen_comparisons WHERE specimen_a_id = ${specA} OR specimen_b_id = ${specA}`)[0].n
    : pub
    ? (await sql`SELECT COUNT(*)::int AS n FROM specimen_comparisons WHERE publication_id = ${pub}`)[0].n
    : type
    ? (await sql`SELECT COUNT(*)::int AS n FROM specimen_comparisons WHERE comparison_type = ${type}`)[0].n
    : (await sql`SELECT COUNT(*)::int AS n FROM specimen_comparisons`)[0].n;

  if (!wantsHtml) return json({ version: VERSION, filter: { specimen_id: specA, publication_id: pub, type }, ...pageMeta(limit, offset, rows.length, total), comparisons: rows });

  const compRows = rows.map((c) => `
    <tr>
      <td><a href="/specimens/${encodeURIComponent(c.specimen_a_id)}"><code>${escapeHtml(c.specimen_a_id)}</code></a> ↔ <a href="/specimens/${encodeURIComponent(c.specimen_b_id)}"><code>${escapeHtml(c.specimen_b_id)}</code></a></td>
      <td><code>${escapeHtml(c.comparison_type)}</code></td>
      <td>${escapeHtml(c.claim)}${c.claim_source_quote ? `<div class="quote">${escapeHtml(c.claim_source_quote)}</div>` : ""}</td>
      <td><a href="/publications/${encodeURIComponent(c.publication_id)}"><code>${escapeHtml(c.publication_id)}</code></a></td>
      <td>${verifPill(c.verification_state)}</td>
    </tr>`).join("");

  const body = `
<h1>Cross-specimen comparisons</h1>
<p class="muted">Published claims of relatedness, kinship, sister-lineage status, or introgression source between pairs of specimens. Every row cites a specific publication with a verbatim quote where possible.</p>
<p>${total} total.</p>
${rows.length ? `<table><thead><tr><th>Pair</th><th>Type</th><th>Claim</th><th>Publication</th><th>State</th></tr></thead><tbody>${compRows}</tbody></table>` : `<p class="muted">No comparisons recorded yet.</p>`}
`;
  return html(layout({ title: "Cross-specimen comparisons", body, active: "/comparisons" }));
}

async function routeGraph(sql, specimenId) {
  const specRows = await sql`SELECT id, common_name, taxonomic_assignment, site_id, assignment_publication, provenance_publication FROM specimens WHERE id = ${specimenId}`;
  if (specRows.length === 0) return json({ error: "not_found", id: specimenId }, { status: 404 });
  const spec = specRows[0];

  const pubs = await sql`
    SELECT DISTINCT p.id, p.title, p.year, p.journal
    FROM publications p
    WHERE p.id = ${spec.assignment_publication}
       OR p.id = ${spec.provenance_publication}
       OR p.id IN (SELECT publication_id FROM analyses WHERE specimen_id = ${specimenId})
    ORDER BY p.year DESC, p.id
  `;
  const site = spec.site_id ? (await sql`SELECT id, name, country FROM sites WHERE id = ${spec.site_id}`)[0] : null;
  const compSpecs = await sql`
    SELECT DISTINCT s.id, s.common_name, s.taxonomic_assignment, c.comparison_type
    FROM specimen_comparisons c
    JOIN specimens s ON s.id = CASE WHEN c.specimen_a_id = ${specimenId} THEN c.specimen_b_id ELSE c.specimen_a_id END
    WHERE c.specimen_a_id = ${specimenId} OR c.specimen_b_id = ${specimenId}
  `;

  const nodes = [
    { id: `specimen:${spec.id}`, kind: "specimen", label: spec.common_name ?? spec.id, taxonomic_assignment: spec.taxonomic_assignment, primary: true },
    ...pubs.map((p) => ({ id: `publication:${p.id}`, kind: "publication", label: `${p.title} (${p.year})`, year: p.year, journal: p.journal })),
    ...(site ? [{ id: `site:${site.id}`, kind: "site", label: site.name, country: site.country }] : []),
    ...compSpecs.map((s) => ({ id: `specimen:${s.id}`, kind: "specimen", label: s.common_name ?? s.id, taxonomic_assignment: s.taxonomic_assignment })),
  ];

  const edges = [];
  if (spec.assignment_publication) edges.push({ from: `specimen:${spec.id}`, to: `publication:${spec.assignment_publication}`, kind: "assignment-source" });
  if (spec.provenance_publication && spec.provenance_publication !== spec.assignment_publication) edges.push({ from: `specimen:${spec.id}`, to: `publication:${spec.provenance_publication}`, kind: "provenance-source" });
  if (site) edges.push({ from: `specimen:${spec.id}`, to: `site:${site.id}`, kind: "excavated-at" });
  for (const p of pubs) {
    if (p.id !== spec.assignment_publication && p.id !== spec.provenance_publication) {
      edges.push({ from: `specimen:${spec.id}`, to: `publication:${p.id}`, kind: "analyzed-in" });
    }
  }
  for (const s of compSpecs) {
    edges.push({ from: `specimen:${spec.id}`, to: `specimen:${s.id}`, kind: s.comparison_type });
  }

  return json({ version: VERSION, root: `specimen:${spec.id}`, node_count: nodes.length, edge_count: edges.length, nodes, edges });
}

async function routeSearch(sql, url, wantsHtml) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const type = (url.searchParams.get("type") ?? "").trim().toLowerCase();
  const { limit, offset } = parsePaging(url);

  if (wantsHtml) {
    if (!q) {
      const body = `<h1>Search</h1>
<form class="search" action="/search" method="get">
  <input name="q" placeholder="Search publications and specimens" autofocus />
  <button type="submit">Search</button>
</form>
<p class="muted">Try: <a href="/search?q=hybrid">hybrid</a> · <a href="/search?q=mtDNA">mtDNA</a> · <a href="/search?q=Denisova%2011">Denisova 11</a> · <a href="/search?q=Baishiya">Baishiya</a> · <a href="/search?q=ZooMS">ZooMS</a></p>`;
      return html(layout({ title: "Search", body, active: "/search" }));
    }
    return htmlSearchResults(sql, q, limit, offset);
  }

  if (!q) return json({ error: "missing_query", message: "?q= is required. Optional: ?type=publication|specimen&limit=&offset=" }, { status: 400 });
  if (type && type !== "publication" && type !== "specimen") return json({ error: "invalid_type", message: "type must be 'publication' or 'specimen' (or omitted for both)" }, { status: 400 });

  const results = { query: q, type: type || "both", limit, offset };
  if (type === "" || type === "publication") {
    const total = (await sql`SELECT COUNT(*)::int AS n FROM publications WHERE fts_tsv @@ plainto_tsquery('english', ${q})`)[0].n;
    const rows = await sql`
      SELECT id, title, year, journal, ts_rank(fts_tsv, plainto_tsquery('english', ${q})) AS rank
      FROM publications WHERE fts_tsv @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC, year DESC LIMIT ${limit} OFFSET ${offset}`;
    results.publications = { total, count: rows.length, next_offset: offset + rows.length < total ? offset + rows.length : null, hits: rows };
  }
  if (type === "" || type === "specimen") {
    const total = (await sql`SELECT COUNT(*)::int AS n FROM specimens WHERE fts_tsv @@ plainto_tsquery('english', ${q})`)[0].n;
    const rows = await sql`
      SELECT id, common_name, taxonomic_assignment, assignment_method, verification_state,
             ts_rank(fts_tsv, plainto_tsquery('english', ${q})) AS rank
      FROM specimens WHERE fts_tsv @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC, id LIMIT ${limit} OFFSET ${offset}`;
    results.specimens = { total, count: rows.length, next_offset: offset + rows.length < total ? offset + rows.length : null, hits: rows };
  }
  return json({ version: VERSION, ...results });
}

async function htmlSearchResults(sql, q, limit, offset) {
  // Fire hit lists and facet aggregates in parallel.
  // Facet aggregates use the same FTS query but return counts only:
  //   - `by_table`: total hits per table (publications, specimens)
  //   - `by_year`: hits grouped by publication year (publications only; specimens have no year field)
  const [pubHits, specHits, pubTotal, specTotal, pubByYear] = await Promise.all([
    sql`
      SELECT id, title, year, journal, ts_rank(fts_tsv, plainto_tsquery('english', ${q})) AS rank
      FROM publications WHERE fts_tsv @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC, year DESC LIMIT ${limit} OFFSET ${offset}`,
    sql`
      SELECT id, common_name, taxonomic_assignment, assignment_method, verification_state,
             ts_rank(fts_tsv, plainto_tsquery('english', ${q})) AS rank
      FROM specimens WHERE fts_tsv @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC, id LIMIT ${limit} OFFSET ${offset}`,
    sql`SELECT COUNT(*)::int AS n FROM publications WHERE fts_tsv @@ plainto_tsquery('english', ${q})`,
    sql`SELECT COUNT(*)::int AS n FROM specimens WHERE fts_tsv @@ plainto_tsquery('english', ${q})`,
    sql`
      SELECT year, COUNT(*)::int AS n
      FROM publications
      WHERE fts_tsv @@ plainto_tsquery('english', ${q}) AND year IS NOT NULL
      GROUP BY year ORDER BY year DESC`,
  ]);
  const pubTotalN = pubTotal[0]?.n ?? 0;
  const specTotalN = specTotal[0]?.n ?? 0;

  const pubRows = pubHits.map((p) => `
    <tr>
      <td><a href="/publications/${encodeURIComponent(p.id)}">${escapeHtml(p.title ?? p.id)}</a></td>
      <td>${p.year ?? ""}</td>
      <td>${escapeHtml(p.journal ?? "")}</td>
      <td class="rank">${(p.rank ?? 0).toFixed(3)}</td>
    </tr>`).join("");
  const specRows = specHits.map((s) => `
    <tr>
      <td><a href="/specimens/${encodeURIComponent(s.id)}">${escapeHtml(s.common_name ?? s.id)}</a></td>
      <td>${escapeHtml(s.taxonomic_assignment ?? "unassigned")}</td>
      <td>${verifPill(s.verification_state)}</td>
      <td class="rank">${(s.rank ?? 0).toFixed(3)}</td>
    </tr>`).join("");

  const facetYearRows = pubByYear.length
    ? pubByYear.map((r) => `<li><a href="/publications?year=${r.year}">${r.year}</a> <span class="muted">(${r.n})</span></li>`).join("")
    : "";
  const facetsHtml = `
<div class="facets" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem 2rem;margin:0.5rem 0 1rem;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:4px;background:#fafbfc;">
  <div>
    <div style="font-size:0.85rem;color:var(--muted);margin-bottom:0.25rem;">Hits by table</div>
    <ul style="margin:0;padding-left:1.1rem;font-size:0.9rem;">
      <li>Publications: <strong>${pubTotalN}</strong></li>
      <li>Specimens: <strong>${specTotalN}</strong></li>
    </ul>
  </div>
  <div>
    <div style="font-size:0.85rem;color:var(--muted);margin-bottom:0.25rem;">Publication hits by year</div>
    ${pubByYear.length ? `<ul style="margin:0;padding-left:1.1rem;font-size:0.9rem;column-count:2;">${facetYearRows}</ul>` : `<div class="muted" style="font-size:0.9rem;">No year-tagged matches.</div>`}
  </div>
</div>`;

  const body = `
<h1>Search: <em>${escapeHtml(q)}</em></h1>
<form class="search" action="/search" method="get">
  <input name="q" value="${escapeHtml(q)}" />
  <button type="submit">Search</button>
</form>
${facetsHtml}

<h2>Publications (${pubHits.length})</h2>
${pubHits.length ? `<table><thead><tr><th>Title</th><th>Year</th><th>Journal</th><th class="rank">rank</th></tr></thead><tbody>${pubRows}</tbody></table>` : `<p class="muted">No matches.</p>`}

<h2>Specimens (${specHits.length})</h2>
${specHits.length ? `<table><thead><tr><th>Specimen</th><th>Taxonomic assignment</th><th>State</th><th class="rank">rank</th></tr></thead><tbody>${specRows}</tbody></table>` : `<p class="muted">No matches.</p>`}

<p class="muted"><a href="/search?q=${encodeURIComponent(q)}&type=publication">JSON: publications only</a> · <a href="/search?q=${encodeURIComponent(q)}&type=specimen">JSON: specimens only</a></p>
`;
  return html(layout({ title: `Search: ${q}`, body, active: "/search" }));
}

function routeLicense(wantsHtml) {
  const licenseData = {
    version: VERSION,
    license: "CC BY 4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/legalcode",
    attribution_required: CITATION,
    covers: [
      "All specimen, publication, site, analysis, and comparison rows in this registry",
      "The compilation and structured metadata",
      "Verbatim quoted passages from primary literature are included under fair use for scholarship and are attributed to their original publishers",
    ],
    does_not_cover: [
      "Full text of any peer-reviewed publication referenced by SAR",
      "Underlying paper copyrights, which remain with the original authors and publishers",
    ],
    contact: "See https://github.com/mpgonzalez271/specimen-registry for source and issue tracker",
  };
  if (!wantsHtml) return json(licenseData);

  const body = `
<h1>Data license — CC BY 4.0</h1>
<p>All specimen, publication, site, analysis, and comparison rows in this registry are licensed under the <a href="https://creativecommons.org/licenses/by/4.0/legalcode">Creative Commons Attribution 4.0 International License</a>.</p>

<h2>You are free to</h2>
<ul>
  <li><strong>Share</strong> — copy and redistribute the material in any medium or format</li>
  <li><strong>Adapt</strong> — remix, transform, and build upon the material for any purpose, including commercially</li>
</ul>

<h2>Under the following terms</h2>
<p><strong>Attribution</strong> — you must give appropriate credit, provide a link to the license, and indicate if changes were made. Every JSON response from this API carries a <code>citation</code> field with the exact string below.</p>

<h2>How to attribute</h2>
<pre>${escapeHtml(CITATION)}</pre>

<h2>What CC BY 4.0 covers here</h2>
<ul>
  <li>The compilation and structured metadata</li>
  <li>Verification state, source-quote provenance chain, and cross-specimen comparison rows</li>
  <li>Verbatim quoted passages are included under fair use for scholarship and are attributed to the original publisher</li>
</ul>

<h2>What CC BY 4.0 does <em>not</em> cover</h2>
<ul>
  <li>Full text of any peer-reviewed publication referenced by SAR</li>
  <li>Underlying paper copyrights, which remain with the original authors and publishers</li>
</ul>

<p class="muted"><a href="/license.json">JSON: /license.json</a> · <a href="https://github.com/mpgonzalez271/specimen-registry/blob/main/DATA_LICENSE.md">Repository DATA_LICENSE.md</a></p>
`;
  return html(layout({ title: "License", body, active: "/license" }));
}

// ---- Logging -------------------------------------------------------------

async function logAccess(sql, entry) {
  try {
    await sql`
      INSERT INTO access_log (path, method, status, ip_hash, ua, duration_ms, ray_id)
      VALUES (${entry.path}, ${entry.method}, ${entry.status}, ${entry.ip_hash}, ${entry.ua}, ${entry.duration_ms}, ${entry.ray_id})
    `;
  } catch (e) { /* Never fail requests due to log write */ }
}

// ---- Entry ---------------------------------------------------------------

function wantsHtml(request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

export default {
  async fetch(request, env, ctx) {
    const started = Date.now();
    const url = new URL(request.url);
    let path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Explicit .json suffix forces JSON regardless of Accept header
    let forceJson = false;
    if (path.endsWith(".json")) { path = path.slice(0, -5) || "/"; forceJson = true; }

    const acceptsHtml = !forceJson && wantsHtml(request);

    // Rate limit
    const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
    const ipHash = await sha256Hex(ip + "|sar-v0-salt");
    const rate = checkRate(ipHash);
    if (!rate.ok) {
      return json({ error: "rate_limited", window: rate.window, retry_after: rate.retry_after, limit: rate.limit }, { status: 429, headers: { "Retry-After": String(rate.retry_after) } });
    }

    // Simple routes
    if (path === "/health") return json({ status: "ok", ts: new Date().toISOString() });
    if (path === "/version") {
      return json({
        service: "specimen-registry",
        version: VERSION,
        build_date: BUILD_DATE,
        stage: "pilot-corpus",
        backing_store: "neon-postgres",
        capabilities: ["pagination", "fts-search", "html-browser", "comparisons", "provenance-graph", "license", "rate-limit", "access-log", "stats", "timeline", "audit", "openapi", "methods", "related", "export-csv", "sitemap-xml", "year-filter", "timeline-visual", "stats-chart", "random", "search-facets"],
      }, { rate_remaining: rate.remaining });
    }
    if (path === "/license") return routeLicense(acceptsHtml);
    if (path === "/robots.txt") return text("User-agent: *\nAllow: /\nSitemap: https://specimenregistry.org/sitemap.xml\nSitemap: https://specimenregistry.org/sitemap.txt\n");
    if (path === "/sitemap.txt") {
      const paths = ["/", "/publications", "/specimens", "/sites", "/analyses", "/comparisons", "/search", "/license", "/version", "/stats", "/timeline", "/random", "/audit", "/openapi", "/methods"];
      return text(paths.map((p) => `https://specimenregistry.org${p}`).join("\n") + "\n");
    }
    if (path === "/sitemap.xml") {
      if (!env.DATABASE_URL) return json({ error: "DATABASE_URL not configured" }, { status: 500 });
      const sqlLocal = neon(env.DATABASE_URL);
      const staticPaths = ["/", "/publications", "/specimens", "/sites", "/analyses", "/comparisons", "/search", "/license", "/version", "/stats", "/timeline", "/random", "/audit", "/openapi", "/methods"];
      const specRows = await sqlLocal`SELECT id FROM specimens ORDER BY id`;
      const siteRows = await sqlLocal`SELECT id FROM sites ORDER BY id`;
      const pubRows = await sqlLocal`SELECT id FROM publications ORDER BY id`;
      const urls = [
        ...staticPaths.map(p => ({ loc: `https://specimenregistry.org${p}`, priority: p === "/" ? "1.0" : "0.8" })),
        ...specRows.map(r => ({ loc: `https://specimenregistry.org/specimens/${encodeURIComponent(r.id)}`, priority: "0.7" })),
        ...siteRows.map(r => ({ loc: `https://specimenregistry.org/sites/${encodeURIComponent(r.id)}`, priority: "0.6" })),
        ...pubRows.map(r => ({ loc: `https://specimenregistry.org/publications/${encodeURIComponent(r.id)}`, priority: "0.6" })),
      ];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join("\n")}\n</urlset>\n`;
      return new Response(xml, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", ...CORS } });
    }

    if (!env.DATABASE_URL) return json({ error: "DATABASE_URL not configured" }, { status: 500 });
    const sql = neon(env.DATABASE_URL);

    let response;
    try {
      if (path === "/") response = html(await renderHomepage(sql));
      else if (path === "/corpus") response = await routeCorpus(sql);
      else if (path === "/search") response = await routeSearch(sql, url, acceptsHtml);
      else if (path === "/specimens") response = await routeSpecimens(sql, url, acceptsHtml);
      else if (path === "/sites") response = await routeSites(sql, url);
      else if (path === "/publications") response = await routePublications(sql, url, acceptsHtml);
      else if (path === "/analyses") response = await routeAnalyses(sql, url);
      else if (path === "/comparisons") response = await routeComparisons(sql, url, acceptsHtml);
      else if (path === "/stats") response = await routeStats(sql, acceptsHtml);
      else if (path === "/timeline") response = await routeTimeline(sql, acceptsHtml);
      else if (path === "/random") response = await routeRandom(sql, acceptsHtml);
      else if (path === "/audit") response = await routeAudit(sql, url, acceptsHtml);
      else if (path === "/methods") response = await routeMethods(sql, acceptsHtml);
      else if (path === "/export.csv" || path === "/export") response = await routeExportCsv(sql, url);
      else if (path === "/openapi" || path === "/openapi.json") response = routeOpenAPI();
      else {
        const specM = path.match(/^\/specimens\/([^/]+)$/);
        const siteM = path.match(/^\/sites\/([^/]+)$/);
        const pubM = path.match(/^\/publications\/([^/]+)$/);
        const graphM = path.match(/^\/graph\/([^/]+)$/);
        const relM = path.match(/^\/related\/([^/]+)$/);
        const legacyM = path.match(/^\/corpus\/([^/]+)$/);
        if (specM) response = await routeSpecimenById(sql, decodeURIComponent(specM[1]), acceptsHtml);
        else if (siteM) response = await routeSiteById(sql, decodeURIComponent(siteM[1]), acceptsHtml);
        else if (pubM) response = await routePublicationById(sql, decodeURIComponent(pubM[1]), acceptsHtml);
        else if (graphM) response = await routeGraph(sql, decodeURIComponent(graphM[1]));
        else if (relM) response = await routeRelated(sql, decodeURIComponent(relM[1]));
        else if (legacyM) response = await routePublicationById(sql, decodeURIComponent(legacyM[1]), acceptsHtml);
        else response = json({ error: "not_found", path }, { status: 404 });
      }
    } catch (err) {
      response = json({ error: "internal", message: String(err?.message ?? err) }, { status: 500 });
    }

    const duration_ms = Date.now() - started;
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(logAccess(sql, {
        path,
        method: request.method,
        status: response.status,
        ip_hash: ipHash,
        ua: (request.headers.get("user-agent") ?? "").slice(0, 500),
        duration_ms,
        ray_id: request.headers.get("cf-ray") ?? null,
      }));
    }
    return response;
  },
};
