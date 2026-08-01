#!/usr/bin/env python3
"""Validate M0 frozen schemas, fixtures, and content-release policy checks.

Usage:
  python contracts/m0/validate_schemas.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parent

# fixture filename prefix -> schema URI (with optional $defs fragment)
FIXTURE_SCHEMA = {
    "context-signal": "https://patternlike.app/contracts/m0/context-signal.schema.json",
    "calculation-contract": "https://patternlike.app/contracts/m0/chart-contract.schema.json#/$defs/calculationContract",
    "chart-snapshot": "https://patternlike.app/contracts/m0/chart-contract.schema.json#/$defs/chartSnapshot",
    "reading-evidence": "https://patternlike.app/contracts/m0/reading-evidence.schema.json#/$defs/readingEvidenceGraph",
    "reading-assembly": "https://patternlike.app/contracts/m0/reading-evidence.schema.json#/$defs/readingAssemblyRequest",
    "consent.record": "https://patternlike.app/contracts/m0/consent.schema.json#/$defs/consentRecord",
    "consent.validity": "https://patternlike.app/contracts/m0/consent.schema.json#/$defs/consentValiditySnapshot",
    "consent.permission": "https://patternlike.app/contracts/m0/consent.schema.json#/$defs/contextSourcePermission",
    "consent.sources": "https://patternlike.app/contracts/m0/consent.schema.json#/$defs/contextSourcesDocument",
    "content-release": "https://patternlike.app/contracts/m0/content-release.schema.json#/$defs/contentReleaseBundle",
}


def load_registry() -> Registry:
    registry = Registry()
    for path in ROOT.glob("*.schema.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        schema_id = doc.get("$id")
        if not schema_id:
            raise SystemExit(f"Schema missing $id: {path}")
        resource = Resource.from_contents(doc, default_specification=DRAFT202012)
        registry = registry.with_resource(schema_id, resource)
        registry = registry.with_resource(path.name, resource)
    return registry


def resolve_validator(schema_ref: str, registry: Registry) -> Draft202012Validator:
    if "#/$defs/" in schema_ref:
        base, _, def_name = schema_ref.partition("#/$defs/")
        schema = {"$ref": f"{base}#/$defs/{def_name}"}
        return Draft202012Validator(
            schema, registry=registry, format_checker=FormatChecker()
        )
    res = registry.get_or_retrieve(schema_ref).value.contents
    return Draft202012Validator(
        res, registry=registry, format_checker=FormatChecker()
    )


def match_schema_ref(filename: str) -> str | None:
    for prefix, ref in FIXTURE_SCHEMA.items():
        if filename.startswith(prefix):
            return ref
    return None


def content_release_policy_errors(bundle: dict) -> list[str]:
    """Application-level policies not expressible in plain JSON Schema 2020-12."""
    errs: list[str] = []
    release = bundle.get("release") or {}
    objects = bundle.get("objects") or {}
    signature = bundle.get("signature") or {}

    approver = release.get("approver_id")
    author = release.get("last_author_id")
    if approver is not None and author is not None and approver == author:
        errs.append("dual-control: approver_id must differ from last_author_id")

    bundle_hash = release.get("bundle_hash")
    signed_hash = signature.get("signed_payload_hash")
    if bundle_hash and signed_hash and bundle_hash != signed_hash:
        errs.append(
            "signature: signed_payload_hash must equal release.bundle_hash"
        )

    cycles = {c.get("id"): c for c in objects.get("cycles") or [] if c.get("id")}
    phases = {p.get("id"): p for p in objects.get("phases") or [] if p.get("id")}

    for pid, phase in phases.items():
        parent = phase.get("parent_cycle_id")
        if parent and parent not in cycles:
            errs.append(
                f"graph: phase {pid!r} parent_cycle_id {parent!r} not in objects.cycles"
            )

    for cid, cycle in cycles.items():
        for phase_id in cycle.get("phase_ids") or []:
            if phase_id not in phases:
                errs.append(
                    f"graph: cycle {cid!r} phase_id {phase_id!r} not in objects.phases"
                )

    return errs


def main() -> int:
    registry = load_registry()
    errors: list[str] = []

    for path in sorted(ROOT.glob("*.schema.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        try:
            Draft202012Validator.check_schema(doc)
            print(f"OK  schema meta  {path.name}")
        except SchemaError as exc:
            errors.append(f"SCHEMA {path.name}: {exc}")
            print(f"FAIL schema meta  {path.name}: {exc}")

    valid_dir = ROOT / "fixtures" / "valid"
    invalid_dir = ROOT / "fixtures" / "invalid"

    for path in sorted(valid_dir.glob("*.json")):
        ref = match_schema_ref(path.name)
        if not ref:
            errors.append(f"No schema mapping for valid fixture {path.name}")
            print(f"FAIL mapping     {path.name}")
            continue
        instance = json.loads(path.read_text(encoding="utf-8"))
        validator = resolve_validator(ref, registry)
        try:
            validator.validate(instance)
            print(f"OK  valid        {path.name} -> {ref.split('/')[-1]}")
        except ValidationError as exc:
            errors.append(f"VALID fixture failed {path.name}: {exc.message}")
            print(f"FAIL valid       {path.name}: {exc.message}")
            if exc.absolute_path:
                print(f"     path: {list(exc.absolute_path)}")
            continue

        if path.name.startswith("content-release"):
            policy_errs = content_release_policy_errors(instance)
            if policy_errs:
                for pe in policy_errs:
                    errors.append(f"VALID policy {path.name}: {pe}")
                    print(f"FAIL valid policy {path.name}: {pe}")
            else:
                print(f"OK  policy       {path.name}")

    for path in sorted(invalid_dir.glob("*.json")):
        ref = match_schema_ref(path.name)
        if not ref:
            errors.append(f"No schema mapping for invalid fixture {path.name}")
            print(f"FAIL mapping     {path.name}")
            continue
        instance = json.loads(path.read_text(encoding="utf-8"))
        validator = resolve_validator(ref, registry)

        schema_failed = False
        try:
            validator.validate(instance)
        except ValidationError as exc:
            schema_failed = True
            print(
                f"OK  invalid      {path.name} correctly rejected: {exc.message[:100]}"
            )

        # Policy-only invalid fixtures: schema may pass, policy must fail
        policy_must_fail = path.name.startswith(
            (
                "content-release.same-author",
                "content-release.hash-mismatch",
                "content-release.orphan-phase",
            )
        )
        if policy_must_fail:
            policy_errs = content_release_policy_errors(instance)
            if not policy_errs:
                errors.append(
                    f"INVALID policy fixture unexpectedly passed {path.name}"
                )
                print(f"FAIL invalid policy {path.name} (expected policy failure)")
            else:
                print(
                    f"OK  invalid policy {path.name}: {policy_errs[0]}"
                )
        elif not schema_failed:
            errors.append(
                f"INVALID fixture unexpectedly passed {path.name}"
            )
            print(f"FAIL invalid     {path.name} (expected failure)")

    if errors:
        print(f"\n{len(errors)} error(s)")
        for e in errors:
            print(" -", e)
        return 1
    print("\nAll M0 schema checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
