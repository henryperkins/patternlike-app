#!/usr/bin/env python3
"""Generate the context-source allowlist from the data source registry.

Escalation §6: the schema enforces the id pattern and three D1 CHECKs use
`NOT GLOB 'NO-*'`, but AMB-12 ("Major news and world events") is excluded by
STATUS, not by prefix — so a signal citing it passes both gates. Of the 25
excluded sources, 24 carry the NO- prefix and exactly one does not. A prefix
rule is therefore necessary and not sufficient.

"No source outside the registry can enter reading assembly" is a launch
acceptance criterion, and M3 is the first code that can violate it. So the
allowlist is generated from the registry rather than hand-maintained, and the
engine's test suite re-runs this with --check and fails on drift.

Usage:
  python scripts/generate_source_allowlist.py          # write
  python scripts/generate_source_allowlist.py --check   # fail if stale
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
REGISTRY = ROOT / "spec-bundle" / "pattern_like_astrology_app_data_source_registry_v0.2.yaml"
OUTPUT = HERE.parent / "src" / "source-allowlist.generated.ts"

BANNER = """// GENERATED FILE — DO NOT EDIT.
// Source: spec-bundle/pattern_like_astrology_app_data_source_registry_v0.2.yaml
// Regenerate: npm run generate:allowlist -w @patternlike/reading-engine
//
// A source enters reading assembly only if it appears here. Membership is
// `status != "excluded" AND phase != "never"`, which is strictly narrower than
// the `NO-*` id-prefix rule used by the D1 CHECKs: AMB-12 is excluded by status
// while carrying an ingestible prefix, so the prefix rule alone lets it through.
"""


def ts_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render(registry: dict) -> str:
    sources = registry["sources"]
    vocabulary = sorted(registry["allowed_use_vocabulary"])

    allowed = [
        s
        for s in sources
        if s.get("status") != "excluded" and s.get("phase") != "never"
    ]
    excluded = [s for s in sources if s not in allowed]
    prefix_only = sorted(
        s["id"] for s in excluded if not str(s["id"]).startswith("NO-")
    )

    lines: list[str] = [BANNER]
    lines.append(
        f"/** {len(excluded)} of {len(sources)} registry sources are excluded; "
        f"{len(prefix_only)} of those ({', '.join(prefix_only)}) would survive a "
        "NO-* prefix check. */"
    )
    lines.append(
        "export const EXCLUDED_BUT_NOT_NO_PREFIXED: readonly string[] = ["
        + ", ".join(ts_string(i) for i in prefix_only)
        + "];"
    )
    lines.append("")

    lines.append("/** Every allowed_use token the registry defines. */")
    lines.append("export const REGISTRY_ALLOWED_USE_VOCABULARY: readonly string[] = [")
    for use in vocabulary:
        lines.append(f"  {ts_string(use)},")
    lines.append("];")
    lines.append("")

    lines.append(
        "/** Registry sources that may enter ingestion and reading assembly, with the\n"
        " *  exact uses each is permitted. An empty array means the source may be\n"
        " *  ingested but permits no interpretive use. */"
    )
    lines.append(
        "export const INGESTIBLE_SOURCES: ReadonlyMap<string, readonly string[]> = new Map(["
    )
    for src in sorted(allowed, key=lambda s: str(s["id"])):
        uses = sorted(src.get("allowed_uses") or [])
        rendered = ", ".join(ts_string(u) for u in uses)
        lines.append(f"  [{ts_string(str(src['id']))}, [{rendered}]],")
    lines.append("]);")
    lines.append("")
    lines.append(
        "export const REGISTRY_SOURCE_COUNT = %d;\nexport const INGESTIBLE_SOURCE_COUNT = %d;"
        % (len(sources), len(allowed))
    )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    registry = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))
    rendered = render(registry)

    if "--check" in sys.argv:
        if not OUTPUT.exists():
            print(f"MISSING {OUTPUT.relative_to(ROOT)}", file=sys.stderr)
            return 1
        current = OUTPUT.read_text(encoding="utf-8")
        if current != rendered:
            print(
                f"STALE {OUTPUT.relative_to(ROOT)} — the registry changed since it was "
                "generated. Run: npm run generate:allowlist -w @patternlike/reading-engine",
                file=sys.stderr,
            )
            return 1
        print(f"OK {OUTPUT.name} matches the registry")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
