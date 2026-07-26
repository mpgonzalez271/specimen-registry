#!/usr/bin/env python3
"""
SAR Ingest Linter
=================

Validates that every paper ingest record under `corpus/denisova/` (or a passed
directory) meets the SAR v0 ingest discipline.

Paper types
-----------
Ingest records fall into three structural types, declared by which sections
they contain:

- **specimen** — introduces or updates one or more specimens. Must have
  a specimen-records section AND an analysis-records section.
- **method** — introduces a class of samples (sediment DNA, ZooMS screen)
  but not a named specimen. Must have a study-scope or sample-records
  section AND an analysis-records section.
- **context** — chronology, stratigraphy, geochronology only. Provides
  dating framework for other papers' specimens. Study-scope section
  required; specimen/analysis sections optional.

Universal requirements (all types)
----------------------------------
- Level-1 title starting with `# Ingest Record —`
- `## Publication record` (with optional parenthetical, e.g. `(draft for ...)`)
- `## Cross-references`
- `## Pending human review actions`
- At least one DOI-shaped string
- At least 2 source-locked quotations (straight or smart quotes, ≥20 chars)
- Publication table fields: id, title, authors, year, journal,
  volume_issue_pages, publication_date, open_access_url, abstract

Exit codes
----------
- 0 = all files pass
- 1 = one or more files failed lint

Usage
-----
    python3 ingest_lint.py                          # default dir
    python3 ingest_lint.py path/to/corpus/denisova/ # explicit dir
    python3 ingest_lint.py --json                   # machine-readable output
    python3 ingest_lint.py --strict-warnings        # fail on warnings too
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

# Look for ingest files in both workspace layout (02_denisova_pilot/paper_ingest)
# and repo layout (corpus/denisova). First match wins.
_HERE = Path(__file__).resolve().parent
_CANDIDATES = [
    _HERE.parent / "02_denisova_pilot" / "paper_ingest",   # workspace layout
    _HERE.parent / "corpus" / "denisova",                     # repo layout
]
DEFAULT_DIR = next((p for p in _CANDIDATES if p.exists()), _CANDIDATES[0])

# Section detectors — headings may carry parenthetical annotations
SECTION_TITLE = re.compile(r"^# Ingest Record —")
SECTION_PUBLICATION = re.compile(r"^## Publication record\b")
SECTION_CROSSREF = re.compile(r"^## Cross-references\b")
SECTION_REVIEW = re.compile(r"^## Pending human review actions\b")

# Specimen-family section (any of these counts)
SECTION_SPECIMEN_FAMILY = [
    re.compile(r"^## Specimen records?\b"),          # canonical
    re.compile(r"^## New specimens introduced\b"),   # T1.7 style
    re.compile(r"^## Sediment-sample records\b"),    # T1.4 style
    re.compile(r"^## Study scope\b"),                # T1.8 / T1.10 chronology / method-level
    re.compile(
        r"^## Notable single-sample findings\b"
    ),  # T1.10 style
]

# Analysis-family section (any of these counts)
SECTION_ANALYSIS_FAMILY = [
    re.compile(r"^## Analysis records?\b"),          # canonical
    re.compile(r"^## Analyses added by this paper\b"),  # T1.7 style
]

REQUIRED_PUB_FIELDS = [
    "id",
    "title",
    "authors",
    "year",
    "journal",
    "volume_issue_pages",
    "publication_date",
    "open_access_url",
    "abstract",
]

DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+")

# Quotes: straight double, smart “ ”, or French « » — at least 20 chars inside
QUOTE_RE = re.compile(
    r'"([^"]{20,})"'
    r"|"
    r'\u201C([^\u201D]{20,})\u201D'
    r"|"
    r"\u00AB([^\u00BB]{20,})\u00BB"
)

STATUS_MARKERS = ("pending-verification", "pending verification", "DRAFT", "source-locked")


@dataclass
class FileReport:
    path: Path
    passed: bool = True
    paper_type: str = "unknown"
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add_error(self, msg: str) -> None:
        self.passed = False
        self.errors.append(msg)

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)

    def to_dict(self) -> dict:
        return {
            "path": str(self.path),
            "passed": self.passed,
            "paper_type": self.paper_type,
            "errors": self.errors,
            "warnings": self.warnings,
        }


def any_match(patterns: list[re.Pattern[str]], lines: list[str]) -> bool:
    return any(any(p.match(line) for p in patterns) for line in lines)


def classify_paper(lines: list[str]) -> str:
    """Determine paper type by which sections are present."""
    has_canonical_specimen = any(
        re.compile(r"^## Specimen records?\b").match(l) or re.compile(r"^## New specimens introduced\b").match(l)
        for l in lines
    )
    has_sediment_or_sample_class = any(
        re.compile(r"^## Sediment-sample records\b").match(l) or re.compile(r"^## Notable single-sample findings\b").match(l)
        for l in lines
    )
    has_study_scope = any(re.compile(r"^## Study scope\b").match(l) for l in lines)
    has_analysis = any_match(SECTION_ANALYSIS_FAMILY, lines)

    if has_canonical_specimen and has_analysis:
        return "specimen"
    if has_sediment_or_sample_class and has_analysis:
        return "method"
    if has_study_scope and not has_analysis:
        return "context"
    if has_study_scope and has_analysis:
        # Method paper with a study-scope frame (T1.4, T1.10)
        return "method"
    return "unknown"


def lint_file(path: Path) -> FileReport:
    r = FileReport(path=path)
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    # Universal — level-1 title
    if not any(SECTION_TITLE.match(l) for l in lines):
        r.add_error("missing level-1 title: '# Ingest Record — ...'")

    # Universal — publication record
    if not any(SECTION_PUBLICATION.match(l) for l in lines):
        r.add_error("missing required section: ## Publication record")

    # Universal — cross-references
    if not any(SECTION_CROSSREF.match(l) for l in lines):
        r.add_error("missing required section: ## Cross-references")

    # Universal — review checklist
    if not any(SECTION_REVIEW.match(l) for l in lines):
        r.add_error("missing required section: ## Pending human review actions")

    # Classify
    r.paper_type = classify_paper(lines)

    # Type-specific structural checks
    if r.paper_type == "specimen":
        if not any_match(SECTION_ANALYSIS_FAMILY, lines):
            r.add_error("specimen-type paper missing analysis-records section")
    elif r.paper_type == "method":
        if not any_match(SECTION_ANALYSIS_FAMILY, lines):
            r.add_error("method-type paper missing analysis-records section")
    elif r.paper_type == "context":
        # Chronology-only papers are allowed to have no specimen/analysis rows
        pass
    else:  # unknown
        r.add_error(
            "cannot classify paper type: needs one of "
            "(Specimen records / New specimens introduced) + Analysis records, "
            "or Sediment-sample records / Notable single-sample findings + Analysis records, "
            "or Study scope for a chronology/context paper"
        )

    # Publication-record fields
    pub_section_start = None
    for i, line in enumerate(lines):
        if SECTION_PUBLICATION.match(line):
            pub_section_start = i
            break
    if pub_section_start is not None:
        pub_block = "\n".join(lines[pub_section_start:pub_section_start + 80])
        for fld in REQUIRED_PUB_FIELDS:
            patterns = [
                re.compile(rf"\|\s*`{re.escape(fld)}`"),
                re.compile(rf"\|\s*{re.escape(fld)}\b"),
            ]
            if not any(p.search(pub_block) for p in patterns):
                r.add_error(f"publication table missing field: {fld}")

    # DOI presence
    if not DOI_RE.search(text):
        r.add_error("no DOI (10.xxxx/...) found anywhere in file")

    # Source-locked quotation presence — count quotes with ≥20 non-empty chars
    quotes = QUOTE_RE.findall(text)
    real_quotes = [next(g for g in tup if g) for tup in quotes]
    if len(real_quotes) < 2:
        r.add_error(
            f"expected at least 2 source-locked quotations (>=20 chars); found {len(real_quotes)}"
        )

    # Status marker
    if not any(m.lower() in text.lower() for m in STATUS_MARKERS):
        r.add_warning(
            "no verification status marker found (expected one of: pending-verification, DRAFT, source-locked)"
        )

    # File-name convention
    if not re.match(r"^T\d+\.\d+_[A-Za-z].*\.md$", path.name):
        r.add_warning(f"filename does not match T{'{'}tier{'}'}.{'{'}n{'}'}_Author_Year.md convention")

    return r


def find_ingest_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    return sorted(p for p in root.iterdir() if p.is_file() and p.suffix == ".md" and p.name.startswith("T"))


def main() -> int:
    parser = argparse.ArgumentParser(description="SAR ingest-record linter")
    parser.add_argument(
        "path",
        nargs="?",
        default=str(DEFAULT_DIR),
        help=f"directory containing T*.md ingest records (default: {DEFAULT_DIR})",
    )
    parser.add_argument("--json", action="store_true", help="output JSON instead of human-readable text")
    parser.add_argument("--strict-warnings", action="store_true", help="treat warnings as errors")
    args = parser.parse_args()

    root = Path(args.path)
    files = list(find_ingest_files(root))
    if not files:
        print(f"error: no T*.md files found in {root}", file=sys.stderr)
        return 2

    reports = [lint_file(p) for p in files]

    for r in reports:
        if args.strict_warnings and r.warnings:
            r.passed = False

    if args.json:
        out = {
            "total": len(reports),
            "passed": sum(1 for r in reports if r.passed),
            "failed": sum(1 for r in reports if not r.passed),
            "files": [r.to_dict() for r in reports],
        }
        print(json.dumps(out, indent=2))
    else:
        for r in reports:
            status = "PASS" if r.passed else "FAIL"
            print(f"[{status}] [{r.paper_type:>8}] {r.path.name}")
            for e in r.errors:
                print(f"    ERROR  {e}")
            for w in r.warnings:
                print(f"    WARN   {w}")
        n_pass = sum(1 for r in reports if r.passed)
        n_fail = sum(1 for r in reports if not r.passed)
        print()
        print(f"Total: {len(reports)} | Passed: {n_pass} | Failed: {n_fail}")

    return 0 if all(r.passed for r in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
