#!/usr/bin/env python3
"""Validate every frozen contract package in this repository.

Runs the M0 validator unchanged as a subprocess, then validates contracts/m3
here. contracts/m0 is byte-frozen by the M3 freeze note, and that includes its
validator, so this file adds a package rather than editing one.

Schemas are registered by absolute $id only. The M0 validator also registers a
bare-filename key, which is harmless there but would be ambiguous across two
packages that both ship a common.schema.json; relative $refs resolve against the
containing document's $id, so the $id registration alone is sufficient.

Usage:
  python contracts/validate_schemas.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from hashlib import sha256
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parent
M0 = ROOT / "m0"
M3 = ROOT / "m3"

# fixture filename prefix -> schema URI (longest prefix wins)
FIXTURE_SCHEMA = {
    "assembly-identity": "https://patternlike.app/contracts/m3/assembly-identity.schema.json#/$defs/assemblyIdentityInputV1",
    "reading-assembly": "https://patternlike.app/contracts/m3/reading-assembly.schema.json#/$defs/assemblyRequest",
    "reading-evidence": "https://patternlike.app/contracts/m3/reading-evidence.schema.json#/$defs/readingEvidenceGraph",
    "generation-command": "https://patternlike.app/contracts/m3/generation-command.schema.json#/$defs/generateDailyReadingCommandV1",
    "cycle-identity": "https://patternlike.app/contracts/m3/cycle-identity.schema.json#/$defs/cycleIdentityV1",
    "cycle-request": "https://patternlike.app/contracts/m3/cycle-request.schema.json#/$defs/cycleRequest",
    "cycle-response": "https://patternlike.app/contracts/m3/cycle-response.schema.json#/$defs/cycleResponse",
    "content-release": "https://patternlike.app/contracts/m3/content-release.schema.json#/$defs/contentReleaseBundle",
    "daily-reading": "https://patternlike.app/contracts/m3/daily-reading.schema.json#/$defs/dailyReading",
}

# Fixtures whose defect is a policy rule rather than a schema rule. The schema
# may legitimately accept them; the policy check below must not.
POLICY_ONLY = {
    "assembly-identity.accuracy-mismatch",
    "cycle-response.unordered-passes",
    "cycle-response.noncontiguous-index",
    "cycle-response.count-mismatch",
    "cycle-response.first-exact-mismatch",
    "cycle-response.pass-outside-envelope",
    "cycle-response.unordered-cycles",
    "cycle-response.duplicate-cycle-ids",
    "cycle-response.inverted-envelope",
    "content-release.locale-default-not-supported",
    "content-release.fallback-missing-for-locale",
    "content-release.fallback-duplicate-for-locale",
    "content-release.fallback-locale-mismatch",
    "content-release.timing-template-missing-for-locale",
    "content-release.timing-undeclared-placeholder",
    "content-release.same-author",
}

PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")

# Tokens that must never appear in a serialized assembly request. Spec section 10
# forbids stable direct identifiers at the assembly boundary; this is the
# mechanical half of that prohibition.
FORBIDDEN_IN_ASSEMBLY_REQUEST = (
    "reading_key",
    "user_id",
    "chart_fingerprint",
    "local_date",
    "target_timezone",
    "generation_anchor",
    "usr_",
    "cs_",
)


def load_registry() -> Registry:
    registry = Registry()
    for package in (M0, M3):
        for path in sorted(package.glob("*.schema.json")):
            doc = json.loads(path.read_text(encoding="utf-8"))
            schema_id = doc.get("$id")
            if not schema_id:
                raise SystemExit(f"Schema missing $id: {path}")
            registry = registry.with_resource(
                schema_id, Resource.from_contents(doc, default_specification=DRAFT202012)
            )
    return registry


def resolve_validator(ref: str, registry: Registry) -> Draft202012Validator:
    return Draft202012Validator(
        {"$ref": ref}, registry=registry, format_checker=FormatChecker()
    )


def match_schema_ref(filename: str) -> str | None:
    best: tuple[int, str] | None = None
    for prefix, ref in FIXTURE_SCHEMA.items():
        if filename.startswith(prefix) and (best is None or len(prefix) > best[0]):
            best = (len(prefix), ref)
    return best[1] if best else None


# ---------------------------------------------------------------------------
# Policy checks — rules JSON Schema 2020-12 cannot express
# ---------------------------------------------------------------------------


def assembly_identity_policy(doc: dict) -> list[str]:
    errs: list[str] = []
    declared = doc.get("effective_accuracy")
    projected = (doc.get("uncertainty") or {}).get("accuracy")
    if declared is not None and projected is not None and declared != projected:
        errs.append(
            f"effective_accuracy {declared!r} disagrees with uncertainty.accuracy "
            f"{projected!r}: two copies of one decision is how an unknown-time chart "
            "acquires an exact-time reading"
        )
    for name in ("facts", "context"):
        items = doc.get(name) or []
        keys = [json.dumps(i, sort_keys=True) for i in items]
        if len(set(keys)) != len(keys):
            errs.append(f"{name} contains duplicates; the preimage must be a set")
    facts = doc.get("facts") or []
    ordered = sorted(facts, key=lambda f: (f.get("first_exact_at") or "", f.get("id") or ""))
    if facts != ordered:
        errs.append(
            "facts are not in (first_exact_at, id) order; JCS preserves array order, "
            "so an unsorted array yields a different id for the same fact set"
        )
    return errs


def cycle_response_policy(doc: dict) -> list[str]:
    errs: list[str] = []
    if not doc.get("ok"):
        return errs
    cycles = doc.get("cycles") or []
    ids = [c.get("id") for c in cycles]
    if len(set(ids)) != len(ids):
        errs.append("duplicate cycle ids in one response")
    ordered = sorted(cycles, key=lambda c: (c.get("exact_at") or "", c.get("id") or ""))
    if cycles != ordered:
        errs.append("cycles are not ordered by (exact_at, id)")
    for cycle in cycles:
        cid = cycle.get("id")
        passes = cycle.get("passes") or []
        if cycle.get("pass_count") != len(passes):
            errs.append(
                f"cycle {cid}: pass_count {cycle.get('pass_count')} != passes.length {len(passes)}"
            )
        indices = [p.get("pass_index") for p in passes]
        if indices != list(range(1, len(passes) + 1)):
            errs.append(f"cycle {cid}: pass indices {indices} are not contiguous from 1")
        times = [p.get("exact_at") for p in passes]
        if times != sorted(times) or len(set(times)) != len(times):
            errs.append(f"cycle {cid}: pass timestamps are not strictly chronological")
        if passes and cycle.get("exact_at") != times[0]:
            errs.append(
                f"cycle {cid}: exact_at {cycle.get('exact_at')} != passes[0].exact_at {times[0]}"
            )
        start, end = cycle.get("start_at"), cycle.get("end_at")
        if start and end and start > end:
            errs.append(f"cycle {cid}: start_at is after end_at")
        for t in times:
            if start and end and not (start <= t <= end):
                errs.append(f"cycle {cid}: pass {t} lies outside the orb envelope")
    return errs


def content_release_policy(bundle: dict, catalogue: set[str]) -> list[str]:
    errs: list[str] = []
    release = bundle.get("release") or {}
    objects = bundle.get("objects") or {}

    approver, author = release.get("approver_id"), release.get("last_author_id")
    if approver is not None and author == approver:
        errs.append("dual-control: approver_id must differ from last_author_id")

    bundle_hash = release.get("bundle_hash")
    signed = (bundle.get("signature") or {}).get("signed_payload_hash")
    if bundle_hash and signed and bundle_hash != signed:
        errs.append("signature: signed_payload_hash must equal release.bundle_hash")

    supported = release.get("supported_locales") or []
    if release.get("locale_default") not in supported:
        errs.append("locale_default_not_supported")

    for target in (release.get("language_fallbacks") or {}).values():
        if target not in supported:
            errs.append(f"language_fallback target {target!r} is not a supported locale")

    fallbacks = objects.get("daily_fallbacks") or []
    by_locale: dict[str, int] = {}
    for fb in fallbacks:
        loc = fb.get("locale")
        by_locale[loc] = by_locale.get(loc, 0) + 1
        if loc not in supported:
            errs.append(f"fallback_locale_mismatch: {loc!r} is not a supported locale")
        if fb.get("eligibility_mode") != "universal":
            errs.append(f"fallback_not_universal: {fb.get('id')!r}")
    for loc in supported:
        count = by_locale.get(loc, 0)
        if count == 0:
            errs.append(f"fallback_missing_for_locale: {loc!r}")
        elif count > 1:
            errs.append(f"fallback_duplicate_for_locale: {loc!r}")

    templates = objects.get("timing_templates") or []
    defaults: dict[str, int] = {}
    for tpl in templates:
        loc = tpl.get("locale")
        if tpl.get("is_locale_default"):
            defaults[loc] = defaults.get(loc, 0) + 1
        declared = set(tpl.get("placeholders") or [])
        used = set(PLACEHOLDER_RE.findall(tpl.get("template_text") or ""))
        undeclared = used - declared
        if undeclared:
            errs.append(
                f"timing_template {tpl.get('id')!r} uses undeclared placeholders "
                f"{sorted(undeclared)}"
            )
    for loc in supported:
        if defaults.get(loc, 0) == 0:
            errs.append(f"timing_template_missing_for_locale: {loc!r}")

    cycles = {c.get("id"): c for c in objects.get("cycles") or [] if c.get("id")}
    phases = {p.get("id"): p for p in objects.get("phases") or [] if p.get("id")}
    for pid, phase in phases.items():
        parent = phase.get("parent_cycle_id")
        if parent and parent not in cycles:
            errs.append(f"graph: phase {pid!r} parent_cycle_id {parent!r} not in cycles")
    for cid, cycle in cycles.items():
        for phase_id in cycle.get("phase_ids") or []:
            if phase_id not in phases:
                errs.append(f"graph: cycle {cid!r} phase_id {phase_id!r} not in phases")

    for declared_fixture in bundle.get("fixtures") or []:
        fid = declared_fixture.get("fixture_id")
        if fid not in catalogue:
            errs.append(f"fixtures_unknown: {fid!r} has no entry in fixtures/assembly/")

    return errs


def assembly_request_policy(doc: dict) -> list[str]:
    encoded = json.dumps(doc)
    return [
        f"assembly boundary: serialized request contains {token!r}"
        for token in FORBIDDEN_IN_ASSEMBLY_REQUEST
        if token in encoded
    ]


def check_golden_vectors(path: Path) -> list[str]:
    """Verify the vector file is internally consistent.

    Byte-for-byte equality against a live serializer is asserted by the
    TypeScript suite in packages/reading-engine, which is the normative
    implementation. Here we prove the recorded bytes really do hash to the
    recorded digest and really do parse back to the recorded input, so a vector
    cannot drift into self-contradiction.
    """
    errs: list[str] = []
    doc = json.loads(path.read_text(encoding="utf-8"))
    seen: dict[str, str] = {}
    for vec in doc.get("vectors") or []:
        name = vec["name"]
        canonical = vec["canonical"]
        digest = sha256(canonical.encode("utf-8")).hexdigest()
        if digest != vec["full_digest"]:
            errs.append(f"vector {name}: full_digest does not match SHA-256 of canonical")
        prefix = vec["rendered_id"].split("_")[0] + "_"
        if vec["rendered_id"] != prefix + vec["full_digest"][:32]:
            errs.append(f"vector {name}: rendered_id is not prefix + digest[:32]")
        if json.loads(canonical) != vec["input"]:
            errs.append(f"vector {name}: canonical does not parse back to input")
        seen[name] = canonical

    a, b = "assembly-identity-daily", "assembly-identity-daily-reordered"
    if a in seen and b in seen and seen[a] != seen[b]:
        errs.append("reordering object keys changed the canonical bytes")
    a, b = "assembly-identity-zero-facts", "assembly-identity-unknown-time"
    if a in seen and b in seen and seen[a] == seen[b]:
        errs.append("an uncertainty change did not change the canonical bytes")
    return errs


# ---------------------------------------------------------------------------


def validate_package(registry: Registry, package: Path, catalogue: set[str]) -> list[str]:
    errors: list[str] = []

    for path in sorted(package.glob("*.schema.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        try:
            Draft202012Validator.check_schema(doc)
            print(f"OK  schema meta   {path.name}")
        except SchemaError as exc:
            errors.append(f"SCHEMA {path.name}: {exc}")
            print(f"FAIL schema meta   {path.name}: {exc}")

    def policy_errors(name: str, instance: dict) -> list[str]:
        if name.startswith("content-release"):
            return content_release_policy(instance, catalogue)
        if name.startswith("assembly-identity"):
            return assembly_identity_policy(instance)
        if name.startswith("cycle-response"):
            return cycle_response_policy(instance)
        if name.startswith("reading-assembly"):
            return assembly_request_policy(instance)
        return []

    for path in sorted((package / "fixtures" / "valid").glob("*.json")):
        ref = match_schema_ref(path.name)
        if not ref:
            errors.append(f"No schema mapping for valid fixture {path.name}")
            print(f"FAIL mapping      {path.name}")
            continue
        instance = json.loads(path.read_text(encoding="utf-8"))
        try:
            resolve_validator(ref, registry).validate(instance)
        except ValidationError as exc:
            errors.append(f"VALID fixture failed {path.name}: {exc.message}")
            print(f"FAIL valid        {path.name}: {exc.message}")
            if exc.absolute_path:
                print(f"     path: {list(exc.absolute_path)}")
            continue
        pe = policy_errors(path.name, instance)
        if pe:
            for e in pe:
                errors.append(f"VALID policy {path.name}: {e}")
                print(f"FAIL valid policy {path.name}: {e}")
        else:
            print(f"OK  valid         {path.name} -> {ref.split('/')[-1]}")

    for path in sorted((package / "fixtures" / "invalid").glob("*.json")):
        ref = match_schema_ref(path.name)
        if not ref:
            errors.append(f"No schema mapping for invalid fixture {path.name}")
            print(f"FAIL mapping      {path.name}")
            continue
        instance = json.loads(path.read_text(encoding="utf-8"))
        stem = path.name[: -len(".json")]

        schema_rejected = False
        try:
            resolve_validator(ref, registry).validate(instance)
        except ValidationError:
            schema_rejected = True

        if stem in POLICY_ONLY:
            pe = policy_errors(path.name, instance)
            if not pe:
                errors.append(f"INVALID policy fixture unexpectedly passed {path.name}")
                print(f"FAIL invalid policy {path.name} (expected a policy failure)")
            else:
                print(f"OK  invalid policy {path.name}: {pe[0]}")
        elif schema_rejected:
            print(f"OK  invalid       {path.name} correctly rejected by schema")
        else:
            errors.append(f"INVALID fixture unexpectedly passed {path.name}")
            print(f"FAIL invalid      {path.name} (expected schema rejection)")

    return errors


PACKAGE_BASE = {
    "m0": "https://patternlike.app/contracts/m0/",
    "m3": "https://patternlike.app/contracts/m3/",
}


def iter_normative_pointers(node, trail=()):
    """Yield every (json-path, pointer) declared by an x-normative-*schema key."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key.startswith("x-normative") and key.endswith("schema"):
                yield ".".join(trail) or "<root>", value
            else:
                yield from iter_normative_pointers(value, trail + (str(key),))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from iter_normative_pointers(value, trail + (str(i),))


def check_normative_pointers(spec: dict, registry: Registry, label: str) -> list[str]:
    """Resolve every `<package>:<file>#/$defs/<name>` pointer against the packages.

    An OpenAPI $ref to an https:// schema id would be silently skipped by an
    offline validator, so the cross-document link would only look checked. This
    resolves each pointer for real: naming a definition nobody ships fails here.
    """
    errors: list[str] = []
    seen = 0
    for where, pointer in iter_normative_pointers(spec):
        package, _, rest = pointer.partition(":")
        base = PACKAGE_BASE.get(package)
        if not base or not rest:
            errors.append(f"{label} {where}: malformed pointer {pointer!r}")
            continue
        try:
            resolved = registry.resolver().lookup(base + rest)
        except Exception as exc:  # noqa: BLE001 - referencing raises Unresolvable
            # referencing's Unresolvable renders the entire target document.
            reason = str(exc).split(" within ")[0][:160]
            errors.append(f"{label} {where}: {pointer} does not resolve ({reason})")
            continue
        if not isinstance(resolved.contents, dict):
            errors.append(f"{label} {where}: {pointer} does not name a schema object")
            continue
        seen += 1
    if not errors:
        print(f"OK  normative     {label}: {seen} schema pointer(s) resolve")
    return errors


def check_openapi(package: Path, registry: Registry) -> list[str]:
    try:
        import yaml
        from openapi_spec_validator import validate
    except ImportError:
        print("OpenAPI SKIP (install openapi-spec-validator pyyaml to enable)")
        return []
    errors: list[str] = []
    for path in sorted((package / "openapi").glob("*.yaml")):
        spec = yaml.safe_load(path.read_text(encoding="utf-8"))
        try:
            validate(spec)
            print(
                f"OK  openapi       {path.name} v{spec['info']['version']} "
                f"paths={len(spec['paths'])}"
            )
        except Exception as exc:  # noqa: BLE001 - validator raises several types
            errors.append(f"OPENAPI {path.name}: {exc}")
            print(f"FAIL openapi      {path.name}: {exc}")
            continue
        errors += check_normative_pointers(spec, registry, path.name)
    return errors


def check_m0_frozen() -> list[str]:
    """Prove contracts/m0 is byte-identical to what M3 declared it a successor to.

    Two independent proofs, because they fail in different situations. The
    recorded manifest hash catches an edit even in a checkout with no git
    history; `git diff` catches an edit to any of the other 29 files.
    """
    errors: list[str] = []
    manifest = json.loads((M3 / "SCHEMA_MANIFEST.json").read_text(encoding="utf-8"))
    expected = manifest["predecessor"]["manifest_sha256"]
    actual = sha256((M0 / "SCHEMA_MANIFEST.json").read_bytes()).hexdigest()
    if actual != expected:
        errors.append(
            f"contracts/m0/SCHEMA_MANIFEST.json has changed since the M3 freeze "
            f"(expected {expected}, found {actual})"
        )
    else:
        print("OK  frozen        contracts/m0 manifest matches the recorded M3 predecessor hash")

    proc = subprocess.run(
        ["git", "status", "--porcelain", "--", str(M0)],
        capture_output=True,
        text=True,
        cwd=ROOT.parent,
    )
    if proc.returncode != 0:
        print("    (git unavailable; relying on the manifest hash alone)")
    elif proc.stdout.strip():
        errors.append(
            "contracts/m0 has uncommitted modifications; the M3 freeze requires it "
            f"byte-frozen:\n{proc.stdout.strip()}"
        )
    else:
        print("OK  frozen        contracts/m0 has no working-tree changes")
    return errors


def main() -> int:
    print("== freeze ==")
    freeze_errors = check_m0_frozen()
    for e in freeze_errors:
        print(f"FAIL frozen       {e}")

    print("\n== contracts/m0 (frozen; validated by its own unmodified validator) ==")
    m0 = subprocess.run(
        [sys.executable, str(M0 / "validate_schemas.py")],
        capture_output=True,
        text=True,
    )
    tail = [line for line in m0.stdout.splitlines() if line.startswith(("FAIL", "All", "-"))]
    print("\n".join(tail) or m0.stdout[-2000:])
    if m0.returncode != 0:
        print(m0.stdout)
        print(m0.stderr, file=sys.stderr)
        return m0.returncode

    print("\n== contracts/m3 ==")
    catalogue = {p.stem for p in (M3 / "fixtures" / "assembly").glob("*.json")}
    print(f"OK  catalogue     {len(catalogue)} assembly fixtures")

    registry = load_registry()
    errors = list(freeze_errors)
    errors += validate_package(registry, M3, catalogue)
    errors += check_openapi(M3, registry)

    vectors = M3 / "fixtures" / "canonicalization" / "jcs-golden-vectors.json"
    if vectors.exists():
        ve = check_golden_vectors(vectors)
        errors += [f"VECTORS: {e}" for e in ve]
        for e in ve:
            print(f"FAIL vectors      {e}")
        if not ve:
            print("OK  vectors       jcs-golden-vectors.json")
    else:
        errors.append("VECTORS: jcs-golden-vectors.json is missing")

    if errors:
        print(f"\n{len(errors)} error(s)")
        for e in errors:
            print(" -", e)
        return 1
    print("\nAll contract package checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
