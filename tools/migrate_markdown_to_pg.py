#!/usr/bin/env python3
"""Migrate SAR ingest markdown files into the Neon Postgres database.

Best-effort parser: extracts what it can from each T*.md file's canonical
sections (## Publication record / ## Specimen record / ## Analysis records
etc.), inserts one publication row plus zero-or-more specimen/site/analysis
rows per file, and stores the raw markdown in verification_notes so no
detail is lost.

All rows are inserted with verification_state='draft'. Nothing is auto-
promoted — that's Michael's editorial call.

Usage:
    python3 tools/migrate_markdown_to_pg.py           # migrate
    python3 tools/migrate_markdown_to_pg.py --dry     # parse & summarize only
    python3 tools/migrate_markdown_to_pg.py --reset   # wipe DB first, then migrate

Reads NEON_DATABASE_URL from /home/user/workspace/sar/.env
"""
import argparse
import json
import re
import sys
from pathlib import Path

import psycopg

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env"
INGEST_CANDIDATES = [
    REPO_ROOT / "02_denisova_pilot" / "paper_ingest",
    REPO_ROOT / "corpus" / "denisova",
]
# Additional corpus subdirectories to scan for Tier-2+ ingest files.
# Each is optional — missing directories are silently skipped.
ADDITIONAL_INGEST_DIRS = [
    REPO_ROOT / "corpus" / "vindija",
    REPO_ROOT / "corpus" / "sima",
    REPO_ROOT / "corpus" / "oase",
    REPO_ROOT / "corpus" / "multi_site",
    REPO_ROOT / "corpus" / "late_neanderthals",
    REPO_ROOT / "corpus" / "early_neanderthals",
    REPO_ROOT / "corpus" / "present_day_humans",
]

# Enum whitelists (must match SCHEMA_v0.sql + v0.1)
ASSIGNMENT_METHODS = {
    "morphology-2d": "morphology-2D",
    "morphology-3d": "morphology-3D",
    "adna-mitochondrial": "aDNA-mitochondrial",
    "adna-nuclear": "aDNA-nuclear",
    "adna-shotgun": "aDNA-shotgun",
    "paleoproteomics": "paleoproteomics",
    "zooms": "paleoproteomics",  # ZooMS is a paleoproteomic technique
    "sediment-dna": "sediment-DNA",
    "sediment dna": "sediment-DNA",
    "stratigraphic-association": "stratigraphic-association",
    "combined": "combined",
}
DATING_METHODS = {
    "radiocarbon-ams": "radiocarbon-AMS",
    "radiocarbon": "radiocarbon-AMS",
    "u-series": "u-series",
    "u-th": "u-th",
    "esr": "esr",
    "osl": "osl",
    "tl": "tl",
    "ar-ar": "ar-ar",
    "bayesian-modeling": "bayesian-modeling",
    "faunal-biochronology": "faunal-biochronology",
    "associated": "associated",
}
STUDY_TYPES = {"specimen", "method", "chronology", "context", "review"}

# ---- Section-splitting regexes ---------------------------------------
H2 = re.compile(r"^## +(.+?)\s*$", re.MULTILINE)
H3 = re.compile(r"^### +(.+?)\s*$", re.MULTILINE)
KV_ROW = re.compile(r"^\|\s*`?([^`|]+?)`?(?:\s*\([^)]*\))?\s*\|\s*(.+?)\s*\|\s*$", re.MULTILINE)


def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def find_ingest_dir():
    for c in INGEST_CANDIDATES:
        if c.exists():
            return c
    raise FileNotFoundError(f"No ingest directory found in {INGEST_CANDIDATES}")


def split_sections(md_text):
    """Return dict {section_name_lower: section_body}."""
    # Find all H2 positions
    matches = list(H2.finditer(md_text))
    sections = {}
    for i, m in enumerate(matches):
        name = m.group(1).strip().lower()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md_text)
        body = md_text[start:end].strip()
        # Strip parenthetical annotations from section name for lookup
        name_clean = re.sub(r"\s*\([^)]*\)\s*", "", name).strip()
        sections[name_clean] = body
    return sections


def parse_kv_table(body):
    """Parse a markdown key-value table into a dict.

    Skips the header separator row (|---|---|).
    Returns lowercased keys with the value string trimmed.
    """
    out = {}
    for m in KV_ROW.finditer(body):
        key = m.group(1).strip().lower()
        # Skip separator rows
        if set(key).issubset({"-", " "}) or not key:
            continue
        # Skip the header row (labels like "Field | Value")
        if key in ("field", "value"):
            continue
        val = m.group(2).strip()
        # Strip trailing "| … |" style suffixes just in case
        val = re.sub(r"^\s*\|\s*", "", val)
        val = re.sub(r"\s*\|\s*$", "", val)
        out[key] = val
    return out


def split_h3_subsections(body):
    """Split a section body by ### headings, returning [(heading, body), ...]."""
    matches = list(H3.finditer(body))
    if not matches:
        return [("", body)]
    out = []
    for i, m in enumerate(matches):
        heading = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        out.append((heading, body[start:end].strip()))
    return out


def clean_val(v):
    """Trim surrounding quotes and parenthetical notes for scalar fields."""
    if v is None:
        return None
    v = v.strip()
    # Drop leading/trailing markdown emphasis
    v = re.sub(r"^\*\*(.+?)\*\*$", r"\1", v)
    v = v.strip()
    return v or None


def extract_first_verbatim_quote(s):
    """Given a value like: '"quoted passage" (context info)', return the quoted passage."""
    if not s:
        return None
    m = re.search(r'"([^"]{10,})"', s)
    if m:
        return m.group(1).strip()
    m = re.search(r"\u201C([^\u201D]{10,})\u201D", s)
    if m:
        return m.group(1).strip()
    return None


def parse_year(s):
    m = re.search(r"\b(1[89]\d{2}|20\d{2})\b", s or "")
    return int(m.group(1)) if m else None


def parse_iso_date(s):
    if not s:
        return None
    m = re.search(r"(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def parse_vol_issue_pages(s):
    """Best-effort parse of 'vol (issue): start-end' variants.

    Returns (volume, issue, pages) as strings or None.
    """
    if not s:
        return None, None, None
    vol = issue = pages = None
    m = re.match(r"^\s*(\d+)\s*(?:\((\d+)\))?\s*:\s*(\S.+?)\s*$", s)
    if m:
        vol = m.group(1)
        issue = m.group(2)
        pages = m.group(3).replace("–", "-").strip()
    else:
        # Fall back: dump the whole thing in `pages`
        pages = s.strip()
    return vol, issue, pages


def normalize_assignment_method(s):
    if not s:
        return None
    key = s.lower().split("(")[0].strip()
    # First direct hit
    if key in ASSIGNMENT_METHODS:
        return ASSIGNMENT_METHODS[key]
    # Otherwise try to find any known method substring
    for k, v in ASSIGNMENT_METHODS.items():
        if k in key:
            return v
    return None


def parse_authors(raw):
    """Split author string into a list. Handles both ';' and ',' separators."""
    if not raw:
        return []
    # Strip anything after 'et al.' or a trailing period
    raw = re.sub(r"\bet\s+al\.?.*$", "", raw, flags=re.IGNORECASE).strip()
    if ";" in raw:
        parts = [p.strip() for p in raw.split(";") if p.strip()]
    else:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
    return [p for p in parts if p]


# ---- Per-file parser -------------------------------------------------


def parse_ingest_file(path: Path):
    """Return a dict describing what's in this ingest file.

    Structure:
      {
        "file": str,
        "publication": {...},
        "sites": [{...}, ...],
        "specimens": [{...}, ...],
        "analyses": [{...}, ...],
        "warnings": [str, ...],
        "raw_markdown": str,
      }
    """
    raw = path.read_text()
    sections = split_sections(raw)
    warnings = []

    # --- Publication -------------------------------------------------
    pub_body = sections.get("publication record")
    if not pub_body:
        warnings.append("no ## Publication record section found")
        pub_kv = {}
    else:
        pub_kv = parse_kv_table(pub_body)

    pub_id = clean_val(pub_kv.get("id"))
    # Sometimes "id" carries "(DOI)" annotation which parse_kv_table already stripped
    if not pub_id:
        warnings.append("publication has no id (DOI)")

    vol, issue, pages = parse_vol_issue_pages(pub_kv.get("volume_issue_pages"))
    publication = {
        "id": pub_id,
        "title": clean_val(pub_kv.get("title")),
        "authors": parse_authors(pub_kv.get("authors") or ""),
        "year": parse_year(pub_kv.get("year") or ""),
        "journal": clean_val(pub_kv.get("journal")),
        "volume": vol,
        "issue": issue,
        "pages": pages,
        "publication_date": parse_iso_date(pub_kv.get("publication_date")),
        "open_access_url": clean_val(pub_kv.get("open_access_url")),
        "abstract": extract_first_verbatim_quote(pub_kv.get("abstract") or ""),
    }

    # --- Sites (inline within specimen records mostly; also as own section) -
    site_body = sections.get("site record")
    sites = []
    if site_body:
        subs = split_h3_subsections(site_body)
        for heading, body in subs:
            kv = parse_kv_table(body)
            sid = clean_val(kv.get("id"))
            if not sid:
                # Try to derive from heading
                m = re.search(r"`([a-z0-9-]+)`", heading)
                sid = m.group(1) if m else None
            if not sid:
                continue
            def numval(k):
                v = clean_val(kv.get(k))
                if not v:
                    return None
                m = re.search(r"-?\d+\.?\d*", v)
                return float(m.group(0)) if m else None
            sites.append({
                "id": sid,
                "name": clean_val(kv.get("name")) or sid,
                "country": clean_val(kv.get("country")) or "unknown",
                "region": clean_val(kv.get("region")),
                "latitude": numval("latitude"),
                "longitude": numval("longitude"),
                "site_type": clean_val(kv.get("site_type") or kv.get("type")),
            })

    # --- Specimens ---------------------------------------------------
    specimens = []
    spec_body = (
        sections.get("specimen record")
        or sections.get("specimen records")
        or sections.get("new specimens introduced")
    )
    if spec_body:
        subs = split_h3_subsections(spec_body)
        for heading, body in subs:
            kv = parse_kv_table(body)
            sid = clean_val(kv.get("id"))
            if not sid:
                m = re.search(r"`([a-z0-9-]+)`", heading)
                sid = m.group(1) if m else None
            if not sid:
                continue
            # Skip rows that are Options/decisions, not specimens
            if sid.lower() in ("option a", "option b", "option c", "option a (single string)"):
                continue
            # Extract source-locked quote for taxonomic assignment
            tax_quote_key = next(
                (k for k in kv if "quote for taxonomic assignment" in k),
                None,
            )
            tax_quote = extract_first_verbatim_quote(kv.get(tax_quote_key, "")) if tax_quote_key else None

            specimens.append({
                "id": sid,
                "site_id": clean_val(kv.get("site_id")),
                "common_name": clean_val(kv.get("common_name")) or sid,
                "catalog_number": clean_val(kv.get("catalog_number")),
                "material_type": clean_val(kv.get("material_type")),
                "taxonomic_assignment": clean_val(kv.get("taxonomic_assignment")) or "unspecified",
                "taxonomic_assignment_source_quote": tax_quote,
                "assignment_method": normalize_assignment_method(kv.get("assignment_method")),
                "assignment_publication": clean_val(kv.get("assignment_publication")),
                "provenance_publication": clean_val(kv.get("provenance_publication")),
                "stratigraphic_context": clean_val(kv.get("stratigraphic_context")),
                "current_custody": clean_val(kv.get("current_custody")),
            })

    # --- Analyses ----------------------------------------------------
    analyses = []
    a_body = (
        sections.get("analysis records")
        or sections.get("analysis record")
        or sections.get("analyses added by this paper")
    )
    if a_body:
        subs = split_h3_subsections(a_body)
        for heading, body in subs:
            kv = parse_kv_table(body)
            spec_id = clean_val(kv.get("specimen_id"))
            if not spec_id:
                continue  # Analyses without a specimen link — skip for now
            result = clean_val(kv.get("result_summary")) or "(see raw markdown)"
            # source-locked quote
            q_key = next((k for k in kv if k.startswith("source-locked quote")), None)
            q = extract_first_verbatim_quote(kv.get(q_key, "")) if q_key else None
            analyses.append({
                "specimen_id": spec_id,
                "publication_id": clean_val(kv.get("publication_id")) or publication["id"],
                "method": normalize_assignment_method(kv.get("method")),
                "dating_method": None,  # not in these ingests
                "lab": clean_val(kv.get("lab")),
                "analysis_date": parse_iso_date(kv.get("analysis_date")) or (f"{parse_year(kv.get('analysis_date') or '')}-01-01" if parse_year(kv.get("analysis_date") or "") else None),
                "result_summary": result[:2000],
                "result_summary_source_quote": q,
                "result_data_link": clean_val(kv.get("result_data_link")),
            })

    return {
        "file": path.name,
        "publication": publication,
        "sites": sites,
        "specimens": specimens,
        "analyses": analyses,
        "warnings": warnings,
        "raw_markdown": raw,
    }


# ---- Migrator --------------------------------------------------------


def upsert_publication(cur, pub, raw_md, file_name):
    if not pub["id"]:
        return False
    verification_notes = f"Migrated from ingest file: {file_name}\n\n---RAW MARKDOWN---\n{raw_md}"
    cur.execute(
        """
        INSERT INTO publications (
            id, title, authors, year, journal, volume, issue, pages,
            publication_date, open_access_url, abstract,
            verification_state, verification_notes
        ) VALUES (
            %(id)s, %(title)s, %(authors)s::jsonb, %(year)s, %(journal)s,
            %(volume)s, %(issue)s, %(pages)s, %(publication_date)s,
            %(open_access_url)s, %(abstract)s,
            'draft', %(verification_notes)s
        )
        ON CONFLICT (id) DO UPDATE SET
            title = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.title ELSE EXCLUDED.title END,
            authors = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.authors ELSE EXCLUDED.authors END,
            year = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.year ELSE EXCLUDED.year END,
            journal = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.journal ELSE EXCLUDED.journal END,
            volume = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.volume ELSE EXCLUDED.volume END,
            issue = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.issue ELSE EXCLUDED.issue END,
            pages = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.pages ELSE EXCLUDED.pages END,
            publication_date = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.publication_date ELSE EXCLUDED.publication_date END,
            open_access_url = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.open_access_url ELSE EXCLUDED.open_access_url END,
            abstract = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.abstract ELSE EXCLUDED.abstract END,
            verification_notes = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.verification_notes ELSE EXCLUDED.verification_notes END,
            updated_at = CASE WHEN publications.verification_state IN ('pending-verification','source-locked') THEN publications.updated_at ELSE now() END
        """,
        {**pub, "authors": json.dumps(pub["authors"]), "verification_notes": verification_notes},
    )
    return True


def upsert_site(cur, site):
    cur.execute(
        """
        INSERT INTO sites (id, name, country, region, latitude, longitude, site_type, verification_state)
        VALUES (%(id)s, %(name)s, %(country)s, %(region)s, %(latitude)s, %(longitude)s, %(site_type)s, 'draft')
        ON CONFLICT (id) DO UPDATE SET
            name = CASE WHEN sites.verification_state IN ('pending-verification','source-locked') THEN sites.name ELSE COALESCE(EXCLUDED.name, sites.name) END,
            region = CASE WHEN sites.verification_state IN ('pending-verification','source-locked') THEN sites.region ELSE COALESCE(EXCLUDED.region, sites.region) END,
            latitude = CASE WHEN sites.verification_state IN ('pending-verification','source-locked') THEN sites.latitude ELSE COALESCE(EXCLUDED.latitude, sites.latitude) END,
            longitude = CASE WHEN sites.verification_state IN ('pending-verification','source-locked') THEN sites.longitude ELSE COALESCE(EXCLUDED.longitude, sites.longitude) END,
            site_type = CASE WHEN sites.verification_state IN ('pending-verification','source-locked') THEN sites.site_type ELSE COALESCE(EXCLUDED.site_type, sites.site_type) END,
            updated_at = CASE WHEN sites.verification_state IN ('pending-verification','source-locked') THEN sites.updated_at ELSE now() END
        """,
        site,
    )


def ensure_placeholder_site(cur, site_id):
    """Sites referenced by specimens but not defined inline get a placeholder row."""
    if not site_id:
        return
    cur.execute("SELECT 1 FROM sites WHERE id = %s", (site_id,))
    if cur.fetchone():
        return
    upsert_site(cur, {
        "id": site_id,
        "name": site_id.replace("-", " ").title(),
        "country": "unknown",
        "region": None,
        "latitude": None,
        "longitude": None,
        "site_type": None,
    })


def upsert_specimen(cur, sp):
    cur.execute(
        """
        INSERT INTO specimens (
            id, site_id, common_name, catalog_number, material_type,
            taxonomic_assignment, taxonomic_assignment_source_quote,
            assignment_method, assignment_publication, provenance_publication,
            stratigraphic_context, current_custody, verification_state
        ) VALUES (
            %(id)s, %(site_id)s, %(common_name)s, %(catalog_number)s, %(material_type)s,
            %(taxonomic_assignment)s, %(taxonomic_assignment_source_quote)s,
            %(assignment_method)s, %(assignment_publication)s, %(provenance_publication)s,
            %(stratigraphic_context)s::jsonb, %(current_custody)s, 'draft'
        )
        ON CONFLICT (id) DO UPDATE SET
            common_name = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.common_name ELSE EXCLUDED.common_name END,
            catalog_number = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.catalog_number ELSE EXCLUDED.catalog_number END,
            material_type = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.material_type ELSE EXCLUDED.material_type END,
            taxonomic_assignment = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.taxonomic_assignment ELSE EXCLUDED.taxonomic_assignment END,
            taxonomic_assignment_source_quote = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.taxonomic_assignment_source_quote ELSE EXCLUDED.taxonomic_assignment_source_quote END,
            assignment_method = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.assignment_method ELSE EXCLUDED.assignment_method END,
            stratigraphic_context = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.stratigraphic_context ELSE EXCLUDED.stratigraphic_context END,
            current_custody = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.current_custody ELSE EXCLUDED.current_custody END,
            updated_at = CASE WHEN specimens.verification_state IN ('pending-verification','source-locked') THEN specimens.updated_at ELSE now() END
        """,
        {**sp, "stratigraphic_context": json.dumps({"raw": sp["stratigraphic_context"]}) if sp["stratigraphic_context"] else None},
    )


def insert_analysis(cur, a):
    cur.execute(
        """
        INSERT INTO analyses (
            specimen_id, publication_id, method, dating_method, lab,
            analysis_date, result_summary, result_summary_source_quote,
            result_data_link, verification_state
        ) VALUES (
            %(specimen_id)s, %(publication_id)s, %(method)s, %(dating_method)s, %(lab)s,
            %(analysis_date)s, %(result_summary)s, %(result_summary_source_quote)s,
            %(result_data_link)s, 'draft'
        )
        """,
        a,
    )


# ---- Main ------------------------------------------------------------


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="Parse only; no DB writes")
    ap.add_argument("--reset", action="store_true", help="TRUNCATE core tables before migrating")
    args = ap.parse_args(argv)

    env = load_env()
    if "NEON_DATABASE_URL" not in env:
        print("ERROR: NEON_DATABASE_URL not in .env", file=sys.stderr)
        return 1

    ingest_dir = find_ingest_dir()
    files = list(ingest_dir.glob("T*.md"))
    for extra in ADDITIONAL_INGEST_DIRS:
        if extra.exists():
            files.extend(extra.glob("T*.md"))
    # Deduplicate by absolute path
    files = sorted({f.resolve(): f for f in files}.values(), key=lambda p: p.name)
    if not files:
        print(f"ERROR: no T*.md files found in {ingest_dir}", file=sys.stderr)
        return 1

    print(f"Ingest source (primary): {ingest_dir}")
    print(f"Additional dirs scanned: {[str(d) for d in ADDITIONAL_INGEST_DIRS if d.exists()]}")
    print(f"Files: {len(files)}")
    print()

    # Parse all
    parsed = []
    for f in files:
        try:
            p = parse_ingest_file(f)
        except Exception as e:
            print(f"  PARSE FAIL: {f.name}: {type(e).__name__}: {e}")
            continue
        parsed.append(p)
        pub = p["publication"]
        print(f"  {f.name:35s}  doi={pub['id'] or 'MISSING':<40s}  {len(p['specimens'])} spec, {len(p['analyses'])} anal")
        for w in p["warnings"]:
            print(f"    warning: {w}")

    print()
    total_pubs = sum(1 for p in parsed if p["publication"]["id"])
    total_sites = sum(len(p["sites"]) for p in parsed)
    total_specs = sum(len(p["specimens"]) for p in parsed)
    total_ana = sum(len(p["analyses"]) for p in parsed)
    print(f"Parsed: {total_pubs} pubs, {total_sites} inline sites, {total_specs} specimens, {total_ana} analyses")

    if args.dry:
        print("\n--dry: no DB writes performed")
        return 0

    with psycopg.connect(env["NEON_DATABASE_URL"], connect_timeout=30) as conn:
        with conn.cursor() as cur:
            if args.reset:
                print("\n--reset: truncating core tables")
                cur.execute("""
                    TRUNCATE analyses, analysis_comparison_specimens,
                             specimen_assignment_history, sediment_taxa_assignments,
                             sediment_samples, specimens, sites, publications
                    RESTART IDENTITY CASCADE;
                """)

            pub_ok = spec_ok = ana_ok = site_ok = 0
            # Phase 1: all publications and inline sites
            for p in parsed:
                pub = p["publication"]
                if not pub["id"]:
                    continue
                upsert_publication(cur, pub, p["raw_markdown"], p["file"])
                pub_ok += 1
                for s in p["sites"]:
                    upsert_site(cur, s)
                    site_ok += 1
            # Phase 2: all specimens (placeholder-site any missing FKs)
            for p in parsed:
                for sp in p["specimens"]:
                    ensure_placeholder_site(cur, sp["site_id"])
                    if not sp["site_id"]:
                        continue
                    upsert_specimen(cur, sp)
                    spec_ok += 1
            # Phase 3: analyses (dedup by (specimen, publication, method) so re-runs are idempotent)
            for p in parsed:
                for a in p["analyses"]:
                    if not a["specimen_id"]:
                        continue
                    cur.execute("SELECT 1 FROM specimens WHERE id = %s", (a["specimen_id"],))
                    if not cur.fetchone():
                        continue
                    cur.execute("SELECT 1 FROM publications WHERE id = %s", (a["publication_id"],))
                    if not cur.fetchone():
                        continue
                    cur.execute(
                        """SELECT 1 FROM analyses
                           WHERE specimen_id = %s AND publication_id = %s
                           AND COALESCE(method::text, '') = COALESCE(%s, '')""",
                        (a["specimen_id"], a["publication_id"], a["method"]),
                    )
                    if cur.fetchone():
                        continue  # already inserted
                    insert_analysis(cur, a)
                    ana_ok += 1

            conn.commit()

    print()
    print(f"Inserted: {pub_ok} pubs, {site_ok} inline sites, {spec_ok} specimens, {ana_ok} analyses")
    print("All rows in verification_state='draft'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
