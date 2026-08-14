#!/usr/bin/env python3
"""Validate every frozen contract package in this repository.

Runs the M0 validator unchanged as a subprocess, then validates contracts/m3
through contracts/m6 here. Each successor freezes its predecessor; older
packages include their own validators, so this file adds packages rather than
editing one.

Schemas are registered by absolute $id only. The M0 validator also registers a
bare-filename key, which is harmless there but would be ambiguous across three
packages that all ship a common.schema.json; relative $refs resolve against the
containing document's $id, so the $id registration alone is sufficient.

Fixture-to-schema mapping is scoped BY PACKAGE. m3 and m5 both ship
generation-command.*, daily-reading.*, and reading-evidence.* fixtures, and a
single flat prefix map would silently validate an M5 fixture against the M3
schema it supersedes — a superseding package proving itself against its
predecessor is exactly the drift this file exists to catch.

Usage:
  python contracts/validate_schemas.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from hashlib import sha256
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parent
M0 = ROOT / "m0"
M3 = ROOT / "m3"
M4 = ROOT / "m4"
M5 = ROOT / "m5"
M6 = ROOT / "m6"

M3_BASE = "https://patternlike.app/contracts/m3/"
M4_BASE = "https://patternlike.app/contracts/m4/"
M5_BASE = "https://patternlike.app/contracts/m5/"
M6_BASE = "https://patternlike.app/contracts/m6/"

# package -> fixture filename prefix -> schema URI (longest prefix wins WITHIN
# a package). Never flatten these two maps: see the module docstring.
FIXTURE_SCHEMA = {
    "m3": {
        "assembly-identity": M3_BASE
        + "assembly-identity.schema.json#/$defs/assemblyIdentityInputV1",
        "reading-assembly": M3_BASE + "reading-assembly.schema.json#/$defs/assemblyRequest",
        "reading-evidence": M3_BASE + "reading-evidence.schema.json#/$defs/readingEvidenceGraph",
        "generation-command": M3_BASE
        + "generation-command.schema.json#/$defs/generateDailyReadingCommandV1",
        "cycle-identity": M3_BASE + "cycle-identity.schema.json#/$defs/cycleIdentityV1",
        "cycle-pass-identity": M3_BASE
        + "cycle-derivation.schema.json#/$defs/cyclePassIdentityV1",
        "cycle-hash": M3_BASE + "cycle-derivation.schema.json#/$defs/cycleHashPreimageV1",
        "cycle-request": M3_BASE + "cycle-request.schema.json#/$defs/cycleRequest",
        "cycle-response": M3_BASE + "cycle-response.schema.json#/$defs/cycleResponse",
        "timing-response": M3_BASE + "timing-response.schema.json#/$defs/timingResponse",
        "content-release": M3_BASE + "content-release.schema.json#/$defs/contentReleaseBundle",
        "daily-reading-preparation": M3_BASE
        + "daily-reading.schema.json#/$defs/dailyReadingPreparation",
        "daily-reading": M3_BASE + "daily-reading.schema.json#/$defs/dailyReading",
    },
    "m4": {
        "content-release": M4_BASE + "content-release.schema.json#/$defs/contentReleaseBundle",
        "pattern-match": M4_BASE + "natal-feature.schema.json#/$defs/patternMatch",
        "natal-feature": M4_BASE + "natal-feature.schema.json#/$defs/natalFeature",
        "pattern-response": M4_BASE + "pattern-response.schema.json#/$defs/patternResponse",
        "time-travel-response": M4_BASE
        + "time-travel-response.schema.json#/$defs/timeTravelResponse",
        "cycle-scan-receipt": M4_BASE
        + "cycle-scan-receipt.schema.json#/$defs/cycleScanReceipt",
        "life-event-request": M4_BASE + "life-event.schema.json#/$defs/lifeEventRequest",
        "life-event-response": M4_BASE + "life-event.schema.json#/$defs/lifeEvent",
        "life-event-list": M4_BASE + "life-event.schema.json#/$defs/lifeEventList",
    },
    "m5": {
        "daily-sky-request": M5_BASE + "daily-sky-request.schema.json#/$defs/dailySkyRequest",
        "daily-sky-response": M5_BASE + "daily-sky-response.schema.json#/$defs/dailySkyResponse",
        "daily-sky-fact-identity": M5_BASE
        + "daily-sky-response.schema.json#/$defs/dailySkyFactIdentityV1",
        "generation-command": M5_BASE
        + "generation-command.schema.json#/$defs/generateDailyReadingCommandV2",
        "reading-generation-request": M5_BASE
        + "reading-generation-request.schema.json#/$defs/readingGenerationRequest",
        # The document ROOT is the strict candidate object: OpenAI strict mode
        # requires a self-contained root-object schema, so this one cannot hide
        # behind a $defs pointer the way its siblings do.
        "reading-generation-output": M5_BASE + "reading-generation-output.schema.json",
        "daily-reading": M5_BASE + "daily-reading.schema.json#/$defs/dailyReadingV5",
        "reading-evidence": M5_BASE + "reading-evidence.schema.json#/$defs/readingEvidenceGraphV5",
    },
    "m6": {
        "account-export": M6_BASE + "account-export.schema.json#/$defs/accountExport",
        "deletion-status": M6_BASE + "deletion-status.schema.json#/$defs/deletionStatus",
        "export-status": M6_BASE + "export-status.schema.json#/$defs/exportStatus",
    },
}

# Fixtures whose defect is a policy rule rather than a schema rule. The schema
# may legitimately accept them; the policy check below must not.
POLICY_ONLY = {
    "m3": {
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
        "content-release.timing-malformed-placeholder",
        "content-release.timing-nested-placeholder",
        "content-release.timing-residual-closing-brace",
        "content-release.timing-unmatched-opening-brace",
        "content-release.same-author",
        "timing-response.noncontiguous-passes",
    },
    "m4": {
        "natal-feature.aspect-noncanonical",
        "life-event-request.reversed-range",
        "time-travel-response.overlapping-groups",
    },
    "m5": {
        "daily-sky-response.unordered-facts",
        "daily-sky-response.end-boundary-event",
        "reading-generation-output.bad-role-order",
    },
    "m6": set(),
}

braced_placeholder_re = re.compile(r"\{([^{}]*)\}")
placeholder_token_re = re.compile(r"^[a-z_]+$")

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

# ---------------------------------------------------------------------------
# M5 constants
# ---------------------------------------------------------------------------

M5_SCHEMA_VERSION = "0.5.0"

# The closed M0 subset M5 may act on. Not a new enum: contracts/m5 references
# the frozen M0 allowedUse and narrows it. Anything outside this set reaching an
# M5 document means a source acquired a lane the milestone never approved.
M5_SUPPORTED_USES = frozenset(
    {
        "annual_context",
        "environment_context",
        "life_domain_selection",
        "narrative_continuity",
        "optional_recommendations",
        "pattern_profile",
        "reflection_prompt",
        "relationship_interpretation",
        "repetition_control",
        "routine_context",
        "theme_eligibility",
        "theme_filtering",
        "theme_ranking",
        "tone",
        "travel_context",
        "user_memory",
        "workload_context",
    }
)

AI_CONSENT_CATEGORIES = (
    "birth_accuracy_and_uncertainty",
    "calculated_natal_facts",
    "active_calculated_cycles",
    "calculated_daily_sky",
    "enabled_personal_context",
    "prior_reading_excerpts",
    "reading_feedback",
)

# Frozen kind rank. Fact order is (rank, effective_at, fact_id); JCS preserves
# array order, so an unsorted array is a different input manifest for the same
# sky.
DAILY_SKY_KIND_RANK = {
    "anchor_position": 0,
    "lunar_phase": 1,
    "transit_natal_contact": 2,
    "sign_ingress": 3,
    "collective_exact_aspect": 4,
    "house_placement": 5,
}

# Facts sampled AT the anchor rather than solved inside the interval. An anchor
# fact carries anchor_at; every other kind carries a root inside the half-open
# local day.
DAILY_SKY_ANCHOR_KINDS = frozenset({"anchor_position", "lunar_phase", "house_placement"})

DAILY_SKY_PERSONALIZED_KINDS = frozenset({"transit_natal_contact", "house_placement"})

# Tokens that must never appear in a serialized daily-sky request. The closed
# object already rejects an undeclared property; this is the second half, and it
# also catches a declared property that acquired an identifying VALUE.
FORBIDDEN_IN_DAILY_SKY_REQUEST = (
    "user_id",
    "usr_",
    "cs_",
    "chart_id",
    "chart_fingerprint",
    "reading_id",
    "reading_key",
    "birth_date",
    "birth_time",
    "birth_instant",
    "birthplace",
    "latitude",
    "timezone",
)

# Exact JSON keys that must never appear in the provider-bound request. Written
# as quoted keys so `longitude_deg` on a calculated fact is not confused with a
# birth `longitude`, which is the one that matters.
FORBIDDEN_KEYS_IN_GENERATION_REQUEST = (
    "user_id",
    "chart_fingerprint",
    "chart_id",
    "reading_key",
    "reading_id",
    "consent_id",
    "job_id",
    "crypto_subject",
    "birth_date",
    "birth_time",
    "birth_instant",
    "birthplace",
    "latitude",
    "longitude",
    "timezone",
    "release_version",
)

# Value prefixes that name a stored row rather than a fact.
FORBIDDEN_VALUES_IN_GENERATION_REQUEST = ("usr_", "cs_", "rdg_", "cht_", "cns_", "job_", "sig_")


def load_registry() -> Registry:
    registry = Registry()
    for package in (M0, M3, M4, M5, M6):
        if not package.is_dir():
            continue
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


def match_schema_ref(package: str, filename: str) -> str | None:
    best: tuple[int, str] | None = None
    for prefix, ref in FIXTURE_SCHEMA[package].items():
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


def timing_response_policy(doc: dict) -> list[str]:
    errs: list[str] = []

    def instant(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    try:
        as_of = instant(doc["as_of"])
    except (KeyError, TypeError, ValueError) as exc:
        return [f"as_of is not a parseable instant: {exc}"]

    cycles = doc.get("cycles") or []
    parsed: list[tuple[dict, datetime, datetime, list[datetime]]] = []
    for cycle in cycles:
        cid = cycle.get("cycle_id")
        passes = cycle.get("passes") or []
        indices = [p.get("pass_index") for p in passes]
        if indices != list(range(1, len(passes) + 1)):
            errs.append(f"cycle {cid}: pass indices {indices} are not contiguous from 1")

        try:
            start = instant(cycle["start_at"])
            exact = instant(cycle["exact_at"])
            end = instant(cycle["end_at"])
            pass_times = [instant(p["exact_at"]) for p in passes]
        except (KeyError, TypeError, ValueError) as exc:
            errs.append(f"cycle {cid}: timestamp is not parseable: {exc}")
            continue

        if pass_times != sorted(pass_times) or len(set(pass_times)) != len(pass_times):
            errs.append(f"cycle {cid}: pass timestamps are not strictly chronological")
        if pass_times and exact != pass_times[0]:
            errs.append(
                f"cycle {cid}: exact_at {cycle.get('exact_at')} != "
                f"passes[0].exact_at {passes[0].get('exact_at')}"
            )
        if start > end:
            errs.append(f"cycle {cid}: start_at is after end_at")
        for pass_time, pass_doc in zip(pass_times, passes, strict=True):
            if not (start <= pass_time <= end):
                errs.append(
                    f"cycle {cid}: pass {pass_doc.get('exact_at')} lies outside the orb envelope"
                )

        status = cycle.get("status")
        if status == "active" and not (start <= as_of <= end):
            errs.append(f"cycle {cid}: active status disagrees with as_of")
        if status == "upcoming" and not start > as_of:
            errs.append(f"cycle {cid}: upcoming status does not begin after as_of")

        elapsed_days = (end - start).total_seconds() / 86_400
        duration_days = cycle.get("duration_days")
        if not isinstance(duration_days, (int, float)) or abs(duration_days - elapsed_days) > 1e-9:
            errs.append(
                f"cycle {cid}: duration_days {duration_days!r} != elapsed days {elapsed_days}"
            )
        parsed.append((cycle, start, end, pass_times))

    def order_key(item: tuple[dict, datetime, datetime, list[datetime]]):
        cycle, start, end, pass_times = item
        if cycle.get("status") == "active":
            next_pass = min((value for value in pass_times if value >= as_of), default=end)
            return (0, next_pass, cycle.get("cycle_id") or "")
        return (1, start, cycle.get("cycle_id") or "")

    if parsed != sorted(parsed, key=order_key):
        errs.append(
            "cycles are not ordered by active next pass/fallback end, then upcoming start, "
            "with cycle_id as tie-breaker"
        )
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
        template_text = tpl.get("template_text") or ""
        used = set(braced_placeholder_re.findall(template_text))
        malformed_or_undeclared = {
            token
            for token in used
            if not placeholder_token_re.fullmatch(token) or token not in declared
        }
        residual_text = braced_placeholder_re.sub("", template_text)
        has_residual_brace = "{" in residual_text or "}" in residual_text
        if malformed_or_undeclared or has_residual_brace:
            details = sorted(malformed_or_undeclared)
            if has_residual_brace:
                details.append("residual brace")
            errs.append(
                f"timing_template {tpl.get('id')!r} uses malformed or undeclared placeholders "
                f"{details}"
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


# ---------------------------------------------------------------------------
# M5 policy checks
# ---------------------------------------------------------------------------


def _walk_allowed_uses(node, out: list[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "allowed_use" and isinstance(value, str):
                out.append(value)
            elif key == "allowed_uses" and isinstance(value, list):
                out += [v for v in value if isinstance(v, str)]
            else:
                _walk_allowed_uses(value, out)
    elif isinstance(node, list):
        for value in node:
            _walk_allowed_uses(value, out)


def m5_allowed_use_policy(doc: dict) -> list[str]:
    """No M5 document may name a lane outside the approved M0 subset.

    `ai_synthesis` is the outer purpose consent, not an allowed_use, and it can
    never make an otherwise ineligible signal eligible. A value that reaches a
    frozen command outside this set means the intersection was computed against
    something other than the frozen enum.
    """
    seen: list[str] = []
    _walk_allowed_uses(doc, seen)
    return [
        f"allowed_use {value!r} is outside M5_SUPPORTED_USES"
        for value in sorted(set(seen))
        if value not in M5_SUPPORTED_USES
    ]


def _suppressed_classes(uncertainty: dict) -> set[str]:
    return {
        entry.get("feature_class")
        for entry in (uncertainty or {}).get("suppressed_features") or []
        if isinstance(entry, dict)
    }


def daily_sky_request_policy(doc: dict) -> list[str]:
    errs: list[str] = []
    encoded = json.dumps(doc)
    errs += [
        f"daily-sky boundary: serialized request contains {token!r}"
        for token in FORBIDDEN_IN_DAILY_SKY_REQUEST
        if token in encoded
    ]

    declared = doc.get("effective_accuracy")
    projected = (doc.get("uncertainty") or {}).get("accuracy")
    if declared is not None and projected is not None and declared != projected:
        errs.append(
            f"effective_accuracy {declared!r} disagrees with uncertainty.accuracy {projected!r}"
        )

    top = set(doc.get("suppressed_features") or [])
    inner = _suppressed_classes(doc.get("uncertainty") or {})
    if top != inner:
        errs.append(
            f"suppressed_features {sorted(top)} disagrees with the uncertainty report "
            f"{sorted(inner)}: two copies of one decision is how a suppressed feature "
            "reappears as a fact"
        )

    start, end, anchor = doc.get("day_start_at"), doc.get("day_end_at"), doc.get("anchor_at")
    if start and end and not start < end:
        errs.append("day_start_at is not before day_end_at")
    if start and end and anchor and not (start <= anchor < end):
        errs.append("anchor_at lies outside the half-open local day")

    if "houses" in top and doc.get("natal_house_cusps") is not None:
        errs.append("natal_house_cusps supplied while houses are suppressed")
    if "angles" in top:
        angles = [
            p.get("body")
            for p in doc.get("natal_positions") or []
            if p.get("body") in ("ascendant", "midheaven")
        ]
        if angles:
            errs.append(f"angle targets {angles} supplied while angles are suppressed")
    if "moon_time_sensitive" in top:
        if any(p.get("body") == "moon" for p in doc.get("natal_positions") or []):
            errs.append("natal moon supplied while moon_time_sensitive is suppressed")
    return errs


def daily_sky_response_policy(doc: dict) -> list[str]:
    errs: list[str] = []
    if not doc.get("ok"):
        return errs

    facts = doc.get("facts") or []
    ids = [f.get("fact_id") for f in facts]
    if len(set(ids)) != len(ids):
        errs.append("duplicate fact_id in one response")

    def order_key(fact: dict):
        return (
            DAILY_SKY_KIND_RANK.get(fact.get("kind"), 99),
            fact.get("effective_at") or "",
            fact.get("fact_id") or "",
        )

    if facts != sorted(facts, key=order_key):
        errs.append(
            "facts are not in (kind rank, effective_at, fact_id) order; JCS preserves "
            "array order, so an unsorted array is a different input manifest for the "
            "same sky"
        )

    kinds = [f.get("kind") for f in facts]
    if "anchor_position" not in kinds:
        errs.append("a successful response carries no anchor_position fact")
    if kinds.count("lunar_phase") != 1:
        errs.append(
            f"a successful response carries {kinds.count('lunar_phase')} lunar_phase facts; "
            "exactly one is required so an empty event list never means an empty factual day"
        )

    start, end, anchor = doc.get("day_start_at"), doc.get("day_end_at"), doc.get("anchor_at")
    for fact in facts:
        fid, kind, at = fact.get("fact_id"), fact.get("kind"), fact.get("effective_at")
        if kind in DAILY_SKY_ANCHOR_KINDS:
            if anchor and at != anchor:
                errs.append(f"{fid}: {kind} is sampled at {at}, not the anchor {anchor}")
        elif start and end and at is not None and not (start <= at < end):
            errs.append(
                f"{fid}: {kind} at {at} lies outside the half-open local day "
                f"[{start}, {end}); an end-boundary event belongs to the NEXT day"
            )

        digest = fact.get("content_digest") or ""
        hexpart = digest.split(":", 1)[-1]
        if fid and hexpart and fid != "dsf_" + hexpart[:32]:
            errs.append(
                f"{fid}: fact_id is not 'dsf_' + content_digest[0:32] ({hexpart[:32]})"
            )

        expected_scope = (
            "personalized" if kind in DAILY_SKY_PERSONALIZED_KINDS else "collective"
        )
        if fact.get("scope") != expected_scope:
            errs.append(
                f"{fid}: {kind} declares scope {fact.get('scope')!r}; a collective "
                "configuration described as personal is the exact claim the reader "
                "cannot check"
            )

    suppressed = set(doc.get("suppressed_features") or [])
    for fact in facts:
        detail = fact.get("detail") or {}
        target = detail.get("natal_target")
        if "houses" in suppressed and fact.get("kind") == "house_placement":
            errs.append(f"{fact.get('fact_id')}: house fact returned while houses are suppressed")
        if "angles" in suppressed and target in ("ascendant", "midheaven"):
            errs.append(f"{fact.get('fact_id')}: angle target returned while angles are suppressed")
        if "moon_time_sensitive" in suppressed and target == "moon":
            errs.append(
                f"{fact.get('fact_id')}: natal moon target returned while "
                "moon_time_sensitive is suppressed"
            )
    return errs


def generation_command_v2_policy(doc: dict) -> list[str]:
    errs = m5_allowed_use_policy(doc)

    if doc.get("revision_reason") == "initial":
        if doc.get("revision") != 1 or doc.get("supersedes_reading_id") is not None:
            errs.append("initial revision must be revision 1 with no predecessor")
    elif doc.get("supersedes_reading_id") is None:
        errs.append(f"revision_reason {doc.get('revision_reason')!r} requires a predecessor")

    generation = doc.get("command_generation")
    if isinstance(generation, int):
        if generation > 1 and not doc.get("replaces_job_id"):
            errs.append("a replacement command must name the job it replaces")
        if generation == 1 and doc.get("replaces_job_id"):
            errs.append("generation 1 cannot replace a job")

    key = doc.get("reading_key") or ""
    parts = key.split(":")
    if not key.startswith("reading-v5:") or len(parts) != 4:
        errs.append(
            f"reading_key {key!r} is not the closed v5 grammar "
            "reading-v5:<user_id>:<YYYY-MM-DD>:r<revision>"
        )
    else:
        if parts[2] != doc.get("target_local_date"):
            errs.append("reading_key local date disagrees with target_local_date")
        if parts[3] != f"r{doc.get('revision')}":
            errs.append("reading_key revision disagrees with revision")

    chart = doc.get("chart") or {}
    if chart.get("effective_accuracy") != (chart.get("uncertainty") or {}).get("accuracy"):
        errs.append("chart.effective_accuracy disagrees with chart.uncertainty.accuracy")

    start, end, anchor = doc.get("day_start_at"), doc.get("day_end_at"), doc.get("anchor_at")
    if start and end and not start < end:
        errs.append("day_start_at is not before day_end_at")
    if start and end and anchor and not (start <= anchor < end):
        errs.append("anchor_at lies outside the half-open local day")

    selected = [f.get("fact_id") for f in (doc.get("daily_sky") or {}).get("selected") or []]
    if len(set(selected)) != len(selected):
        errs.append("the daily-sky pin selects the same fact twice")
    for pin in (doc.get("daily_sky") or {}).get("selected") or []:
        hexpart = (pin.get("content_digest") or "").split(":", 1)[-1]
        if hexpart and pin.get("fact_id") != "dsf_" + hexpart[:32]:
            errs.append(f"{pin.get('fact_id')}: pinned fact_id disagrees with its content digest")

    refs = [c.get("context_ref") for c in doc.get("context") or []]
    if len(set(refs)) != len(refs):
        errs.append("duplicate context_ref in one command")

    for source, unconfirmed in (("timezone_source", "timezone"), ("locale_source", "locale")):
        if doc.get(source) == "default_unconfirmed":
            errs.append(f"{unconfirmed} is still an unconfirmed server default")

    consent = doc.get("ai_consent") or {}
    if consent.get("kind") != "ai_synthesis" or consent.get("status") != "granted":
        errs.append("a V2 command requires a granted ai_synthesis consent pin")
    declared = list(consent.get("categories") or [])
    if declared != [c for c in AI_CONSENT_CATEGORIES if c in declared]:
        errs.append("ai_consent.categories are not in the frozen policy order")

    if "release_version" in doc or "release_bundle_hash" in doc:
        errs.append("a V2 command cannot carry an editorial release pointer")

    gin = doc.get("generation_input_id") or ""
    if not gin.startswith("gin_sha256_"):
        errs.append(f"generation_input_id {gin!r} is not domain-separated")
    return errs


def reading_generation_request_policy(doc: dict) -> list[str]:
    errs = m5_allowed_use_policy(doc)
    encoded = json.dumps(doc)
    errs += [
        f"provider boundary: request declares the key \"{key}\""
        for key in FORBIDDEN_KEYS_IN_GENERATION_REQUEST
        if f'"{key}"' in encoded
    ]
    errs += [
        f"provider boundary: request carries a stored-row handle {prefix!r}"
        for prefix in FORBIDDEN_VALUES_IN_GENERATION_REQUEST
        if prefix in encoded
    ]

    facts = {f.get("fact_id") for f in doc.get("facts") or []}
    if len(facts) != len(doc.get("facts") or []):
        errs.append("duplicate fact_id in the provider packet")
    refs = [c.get("context_ref") for c in doc.get("context") or []]
    if len(set(refs)) != len(refs):
        errs.append("duplicate context_ref in the provider packet")

    for entry in doc.get("context") or []:
        if entry.get("category") not in AI_CONSENT_CATEGORIES:
            errs.append(
                f"{entry.get('context_ref')}: category {entry.get('category')!r} is not one "
                "of the seven disclosed AI-consent categories"
            )
    return errs


OUTPUT_ROLE_ORDER = ("supporting_theme", "phase_context", "timing", "collective_context")


def reading_generation_output_policy(doc: dict) -> list[str]:
    errs: list[str] = []
    roles = [p.get("role") for p in doc.get("paragraphs") or []]
    if len(set(roles)) != len(roles):
        errs.append(f"paragraph roles {roles} repeat; each role appears at most once")
    ranks = [OUTPUT_ROLE_ORDER.index(r) for r in roles if r in OUTPUT_ROLE_ORDER]
    if ranks != sorted(ranks):
        errs.append(
            f"paragraph roles {roles} are not in the frozen order {list(OUTPUT_ROLE_ORDER)}"
        )

    known_facts = set()
    known_context = set()
    for unit in _grounded_units(doc):
        known_facts |= set(unit.get("fact_ids") or [])
        known_context |= set(unit.get("context_refs") or [])
    for fid in sorted(known_facts):
        if not fid.startswith(("dsf_", "cyc_", "nat_")):
            errs.append(f"fact reference {fid!r} is not an opaque calculated fact handle")
    for ref in sorted(known_context):
        if not ref.startswith("ctx_"):
            errs.append(f"context reference {ref!r} is not an opaque packet handle")

    for unit, label in _grounded_units_labelled(doc):
        if label in ("lead", "supporting_theme", "phase_context", "timing", "collective_context"):
            if not unit.get("fact_ids"):
                errs.append(f"{label} cites no calculated fact")
    return errs


def _grounded_units(doc: dict) -> list[dict]:
    return [unit for unit, _ in _grounded_units_labelled(doc)]


def _grounded_units_labelled(doc: dict) -> list[tuple[dict, str]]:
    units: list[tuple[dict, str]] = []
    if isinstance(doc.get("lead"), dict):
        units.append((doc["lead"], "lead"))
    for paragraph in doc.get("paragraphs") or []:
        units.append((paragraph, paragraph.get("role") or "paragraph"))
    if isinstance(doc.get("reflection_prompt"), dict):
        units.append((doc["reflection_prompt"], "reflection_prompt"))
    if isinstance(doc.get("uncertainty_note"), dict):
        units.append((doc["uncertainty_note"], "uncertainty_note"))
    return units


def daily_reading_v5_policy(doc: dict) -> list[str]:
    errs: list[str] = []
    paragraphs = doc.get("paragraphs") or []
    orders = [p.get("order") for p in paragraphs]
    if orders != list(range(1, len(paragraphs) + 1)):
        errs.append(f"paragraph orders {orders} are not contiguous from 1")
    roles = [p.get("role") for p in paragraphs]
    if roles and roles[0] != "primary_theme":
        errs.append("a v5 reading must open with the primary_theme lead")
    if "safety_fallback" in roles or "fallback_used" in doc or "release_version" in doc:
        errs.append("v5 has no reviewed fallback and no release pointer")
    return errs


def reading_evidence_v5_policy(doc: dict) -> list[str]:
    errs = m5_allowed_use_policy(doc)
    paragraphs = doc.get("paragraphs") or []
    orders = [p.get("order") for p in paragraphs]
    if orders != list(range(1, len(paragraphs) + 1)):
        errs.append(f"evidence paragraph orders {orders} are not contiguous from 1")

    for paragraph in paragraphs:
        pid = paragraph.get("paragraph_id")
        fact_ids = [f.get("fact_id") for f in paragraph.get("fact_refs") or []]
        if len(set(fact_ids)) != len(fact_ids):
            errs.append(f"{pid}: duplicate fact reference")
        for ref in paragraph.get("fact_refs") or []:
            if ref.get("scope") not in ("personalized", "collective"):
                errs.append(f"{pid}: fact reference declares no scope")
        for ref in paragraph.get("context_refs") or []:
            if ref.get("category") not in AI_CONSENT_CATEGORIES:
                errs.append(f"{pid}: context category {ref.get('category')!r} is undisclosed")
        if paragraph.get("role") in (
            "primary_theme",
            "supporting_theme",
            "phase_context",
            "timing",
            "collective_context",
        ) and not fact_ids:
            errs.append(f"{pid}: an astrology paragraph cites no calculated fact")

    validation = doc.get("validation") or {}
    if validation.get("status") != "passed":
        errs.append("only a passed validation may be published")
    if not validation.get("checks"):
        errs.append("validation records no checks")
    for check in validation.get("checks") or []:
        if check.get("passed") is not True:
            errs.append(f"validation check {check.get('code')!r} is not passed")

    if doc.get("revision_reason") == "initial":
        if doc.get("revision") != 1:
            errs.append("an initial evidence graph must be revision 1")
    gin = doc.get("generation_input_id") or ""
    if not gin.startswith("gin_sha256_"):
        errs.append(f"generation_input_id {gin!r} is not domain-separated")
    if (doc.get("model") or {}).get("provider") != "openai":
        errs.append("v5 evidence must record the model that published the prose")
    return errs


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
        rendered_id = vec.get("rendered_id")
        is_cycle_hash_vector = (
            "cycleHashPreimageV1" in (doc.get("profiles") or [])
            and name.startswith("cycle-hash-")
        )
        if rendered_id is None:
            if not is_cycle_hash_vector:
                errs.append(f"vector {name}: rendered_id is required for non-cycle-hash vectors")
        else:
            if not isinstance(rendered_id, str) or "_" not in rendered_id:
                errs.append(f"vector {name}: rendered_id is not a prefixed string")
            else:
                prefix = rendered_id.split("_")[0] + "_"
                if rendered_id != prefix + vec["full_digest"][:32]:
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


def _m3_policy_errors(name: str, instance: dict, catalogue: set[str]) -> list[str]:
    if name.startswith("content-release"):
        return content_release_policy(instance, catalogue)
    if name.startswith("assembly-identity"):
        return assembly_identity_policy(instance)
    if name.startswith("cycle-response"):
        return cycle_response_policy(instance)
    if name.startswith("timing-response"):
        return timing_response_policy(instance)
    if name.startswith("reading-assembly"):
        return assembly_request_policy(instance)
    return []


M4_BODY_RANK = {
    body: rank
    for rank, body in enumerate(
        (
            "sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn",
            "uranus", "neptune", "pluto", "true_node", "ascendant", "midheaven",
        )
    )
}


def _m4_match_errors(match: dict, *, pattern: dict | None = None) -> list[str]:
    errors: list[str] = []
    positive = list(match.get("all_of") or []) + list(match.get("any_of") or [])
    if not positive:
        errors.append("pattern match has no positive predicate")
    for predicate in positive + list(match.get("none_of") or []):
        if predicate.get("type") == "aspect":
            left = M4_BODY_RANK.get(predicate.get("body_a"), 10_000)
            right = M4_BODY_RANK.get(predicate.get("body_b"), 10_000)
            if left >= right:
                errors.append("aspect predicate body order is not canonical")
        if pattern is not None and predicate.get("type") in {"angle", "house_cusp"}:
            if pattern.get("minimum_accuracy") == "unknown" or not pattern.get(
                "requires_houses"
            ):
                errors.append("house or angle predicate lacks an accuracy/house gate")
    return errors


def _m4_policy_errors(name: str, instance: dict) -> list[str]:
    if name.startswith("content-release"):
        errors = content_release_policy(instance, set())
        for pattern in (instance.get("objects") or {}).get("patterns") or []:
            errors += _m4_match_errors(pattern.get("match") or {}, pattern=pattern)
        return errors
    if name.startswith("pattern-match"):
        return _m4_match_errors(instance)
    if name.startswith("natal-feature") and instance.get("feature_class") == "aspect":
        left = M4_BODY_RANK.get(instance.get("body_a"), 10_000)
        right = M4_BODY_RANK.get(instance.get("body_b"), 10_000)
        return [] if left < right else ["natal aspect body order is not canonical"]
    if name.startswith("life-event"):
        start, end = instance.get("start_date"), instance.get("end_date")
        return [] if not end or not start or start <= end else ["life-event end precedes start"]
    if name.startswith("cycle-scan-receipt"):
        start, end = instance.get("window_from"), instance.get("window_to")
        return [] if not start or not end or start < end else ["scan window is not half-open"]
    if name.startswith("time-travel-response"):
        comparison = instance.get("comparison") or {}
        continuing = set(comparison.get("continuing") or [])
        selected = set(comparison.get("selected_only") or [])
        present = set(comparison.get("present_only") or [])
        errors: list[str] = []
        if continuing & selected or continuing & present or selected & present:
            errors.append("comparison cycle belongs to more than one primary group")
        if not set(comparison.get("phase_changed") or []).issubset(continuing):
            errors.append("phase_changed contains a cycle that is not continuing")
        return errors
    return []


def _m5_policy_errors(name: str, instance: dict) -> list[str]:
    if name.startswith("daily-sky-request"):
        return daily_sky_request_policy(instance)
    if name.startswith("daily-sky-response"):
        return daily_sky_response_policy(instance)
    if name.startswith("generation-command"):
        return generation_command_v2_policy(instance)
    if name.startswith("reading-generation-request"):
        return reading_generation_request_policy(instance)
    if name.startswith("reading-generation-output"):
        return reading_generation_output_policy(instance)
    if name.startswith("daily-reading"):
        return daily_reading_v5_policy(instance)
    if name.startswith("reading-evidence"):
        return reading_evidence_v5_policy(instance)
    return m5_allowed_use_policy(instance)


def validate_package(
    registry: Registry, name: str, package: Path, catalogue: set[str]
) -> list[str]:
    errors: list[str] = []

    if not package.is_dir():
        return [f"contract package contracts/{name} is missing"]

    for path in sorted(package.glob("*.schema.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        try:
            Draft202012Validator.check_schema(doc)
            print(f"OK  schema meta   {path.name}")
        except SchemaError as exc:
            errors.append(f"SCHEMA {path.name}: {exc}")
            print(f"FAIL schema meta   {path.name}: {exc}")

    def policy_errors(fixture: str, instance: dict) -> list[str]:
        if name == "m3":
            return _m3_policy_errors(fixture, instance, catalogue)
        if name == "m4":
            return _m4_policy_errors(fixture, instance)
        if name == "m5":
            return _m5_policy_errors(fixture, instance)
        if name == "m6":
            return []
        raise ValueError(f"unregistered contract package policy: {name}")

    for path in sorted((package / "fixtures" / "valid").glob("*.json")):
        ref = match_schema_ref(name, path.name)
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
        ref = match_schema_ref(name, path.name)
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

        if stem in POLICY_ONLY[name]:
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
    "m3": M3_BASE,
    "m4": M4_BASE,
    "m5": M5_BASE,
    "m6": M6_BASE,
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


def _normalised_manifest_digest(package: Path) -> str:
    """SHA-256 over newline-NORMALISED manifest bytes, not raw ones.

    There is no .gitattributes, so git hands Windows checkouts CRLF and Linux
    checkouts LF, and a raw-byte digest therefore records whichever platform
    generated it and fails on the other. The value originally recorded for M0
    came from a CRLF checkout, so its check passed on Windows and failed in
    Linux CI on a file nobody had touched. Normalising costs nothing: a real
    edit still moves the digest.
    """
    raw = (package / "SCHEMA_MANIFEST.json").read_bytes()
    return sha256(raw.replace(b"\r\n", b"\n")).hexdigest()


def _recorded_predecessors(manifest_path: Path) -> dict[str, str]:
    """Read predecessor digests from either manifest shape.

    M3 records a single `predecessor` object; M5 supersedes two packages and
    records a `predecessors` array. Both are read here so a successor can be
    added without rewriting a frozen note.
    """
    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
    recorded: dict[str, str] = {}
    single = doc.get("predecessor")
    if isinstance(single, dict) and single.get("package"):
        recorded[single["package"]] = single.get("manifest_sha256")
    for entry in doc.get("predecessors") or []:
        if isinstance(entry, dict) and entry.get("package"):
            recorded[entry["package"]] = entry.get("manifest_sha256")
    return recorded


def check_frozen(package: Path, label: str, expected: str | None, recorded_by: str) -> list[str]:
    """Prove a predecessor package is unchanged from what its successor froze.

    Two independent proofs, because they fail in different situations. The
    recorded manifest hash catches an edit even in a checkout with no git
    history; `git status` catches an edit to any of the other files.
    """
    errors: list[str] = []
    if expected is None:
        errors.append(f"{recorded_by} records no predecessor digest for {label}")
    else:
        actual = _normalised_manifest_digest(package)
        if actual != expected:
            errors.append(
                f"{label}/SCHEMA_MANIFEST.json has changed since the freeze recorded in "
                f"{recorded_by} (expected {expected}, found {actual})"
            )
        else:
            print(f"OK  frozen        {label} manifest matches the digest recorded in {recorded_by}")

    proc = subprocess.run(
        ["git", "status", "--porcelain", "--", str(package)],
        capture_output=True,
        text=True,
        cwd=ROOT.parent,
    )
    if proc.returncode != 0:
        print("    (git unavailable; relying on the manifest hash alone)")
    elif proc.stdout.strip():
        errors.append(
            f"{label} has uncommitted modifications; the freeze requires it "
            f"byte-frozen:\n{proc.stdout.strip()}"
        )
    else:
        print(f"OK  frozen        {label} has no working-tree changes")
    return errors


def check_predecessors_frozen() -> list[str]:
    """Prove every frozen predecessor directory, automatically.

    M3's freeze proof covered contracts/m0 only. M5 supersedes the
    daily-reading family, and M6 follows M5 with privacy lifecycle additions.
    A manual promise that any one of those directories stayed untouched is not
    a check.
    """
    errors: list[str] = []
    m3_manifest = M3 / "SCHEMA_MANIFEST.json"
    m5_manifest = M5 / "SCHEMA_MANIFEST.json"
    m6_manifest = M6 / "SCHEMA_MANIFEST.json"

    errors += check_frozen(
        M0,
        "contracts/m0",
        _recorded_predecessors(m3_manifest).get("contracts/m0"),
        "contracts/m3/SCHEMA_MANIFEST.json",
    )

    if not m5_manifest.exists():
        errors.append(
            "contracts/m5/SCHEMA_MANIFEST.json is missing, so contracts/m3 has no "
            "recorded freeze and the daily-reading supersession is undocumented"
        )
        return errors

    m5_recorded = _recorded_predecessors(m5_manifest)
    errors += check_frozen(
        M3, "contracts/m3", m5_recorded.get("contracts/m3"), "contracts/m5/SCHEMA_MANIFEST.json"
    )

    # M5 also records M0. Disagreeing with M3's copy would mean two successors
    # believe different things about the same frozen bytes.
    m0_from_m3 = _recorded_predecessors(m3_manifest).get("contracts/m0")
    m0_from_m5 = m5_recorded.get("contracts/m0")
    if m0_from_m5 is None:
        errors.append("contracts/m5/SCHEMA_MANIFEST.json records no contracts/m0 predecessor")
    elif m0_from_m5 != m0_from_m3:
        errors.append(
            "contracts/m5 and contracts/m3 record different digests for the same frozen "
            f"contracts/m0 manifest ({m0_from_m5} vs {m0_from_m3})"
        )
    else:
        print("OK  frozen        contracts/m5 and contracts/m3 agree on the contracts/m0 digest")

    if not m6_manifest.exists():
        errors.append(
            "contracts/m6/SCHEMA_MANIFEST.json is missing, so contracts/m5 has no "
            "recorded freeze and the privacy amendment is undocumented"
        )
        return errors

    m6_recorded = _recorded_predecessors(m6_manifest)
    errors += check_frozen(
        M5, "contracts/m5", m6_recorded.get("contracts/m5"),
        "contracts/m6/SCHEMA_MANIFEST.json"
    )
    m0_from_m6 = m6_recorded.get("contracts/m0")
    if m0_from_m6 is None:
        errors.append("contracts/m6/SCHEMA_MANIFEST.json records no contracts/m0 predecessor")
    elif m0_from_m6 != m0_from_m3:
        errors.append(
            "contracts/m6 and contracts/m3 record different digests for the same frozen "
            f"contracts/m0 manifest ({m0_from_m6} vs {m0_from_m3})"
        )
    else:
        print("OK  frozen        contracts/m6 and contracts/m3 agree on the contracts/m0 digest")
    return errors


REQUIRED_M5_BREAKING_CHANGES = {
    "constrained_model_only",
    "model_evidence_required",
    "release_pointer_removed",
    "reviewed_fallback_removed",
}


def check_m5_manifest() -> list[str]:
    """The manifest is the inventory, so it has to be checkable.

    A per-file $defs map that drifts from the shipped schemas turns the freeze
    note into a description of a package that no longer exists.
    """
    errors: list[str] = []
    path = M5 / "SCHEMA_MANIFEST.json"
    if not path.exists():
        return ["contracts/m5/SCHEMA_MANIFEST.json is missing"]
    doc = json.loads(path.read_text(encoding="utf-8"))

    if doc.get("package") != "contracts/m5":
        errors.append("manifest package is not contracts/m5")
    if doc.get("schema_version") != M5_SCHEMA_VERSION:
        errors.append(f"manifest schema_version is not {M5_SCHEMA_VERSION}")

    declared = {entry.get("file"): entry for entry in doc.get("schemas") or []}
    shipped = {p.name: p for p in sorted(M5.glob("*.schema.json"))}
    for missing in sorted(set(shipped) - set(declared)):
        errors.append(f"manifest does not declare shipped schema {missing}")
    for extra in sorted(set(declared) - set(shipped)):
        errors.append(f"manifest declares {extra}, which the package does not ship")

    for filename, entry in declared.items():
        if filename not in shipped:
            continue
        schema = json.loads(shipped[filename].read_text(encoding="utf-8"))
        if entry.get("id") != schema.get("$id"):
            errors.append(f"{filename}: manifest id disagrees with the document $id")
        listed = sorted(entry.get("defines") or [])
        actual = sorted(schema.get("$defs") or {})
        if listed != actual:
            errors.append(
                f"{filename}: manifest defines {listed} but the document defines {actual}"
            )

    supersedes = doc.get("supersedes") or []
    if not any(
        isinstance(s, dict) and s.get("family") == "daily-reading" for s in supersedes
    ):
        errors.append("manifest records no explicit daily-reading-family supersession")

    breaking = {b.get("id") for b in doc.get("breaking_changes") or []}
    for required in sorted(REQUIRED_M5_BREAKING_CHANGES - breaking):
        errors.append(f"manifest does not inventory the intentional break {required!r}")

    if not errors:
        print(
            f"OK  manifest      contracts/m5 declares {len(declared)} schema(s), both "
            "predecessors, and its breaking-change inventory"
        )
    return errors


def check_m5_openapi_projection() -> list[str]:
    """The product OpenAPI is the consent/status contract, so check it names one.

    Validating the document as OpenAPI proves it parses. It does not prove the
    consent routes exist or that a caller can tell a retryable infrastructure
    503 from an exhausted 424 — which is the difference between a retry control
    that can work and one that cannot.
    """
    try:
        import yaml
    except ImportError:
        return []
    path = M5 / "openapi" / "openapi.yaml"
    if not path.exists():
        return ["contracts/m5/openapi/openapi.yaml is missing"]
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    paths = spec.get("paths") or {}
    errors: list[str] = []

    consent = paths.get("/v1/consents/ai-synthesis")
    if not isinstance(consent, dict):
        errors.append("openapi.yaml does not describe /v1/consents/ai-synthesis")
    else:
        for method in ("get", "put", "delete"):
            if method not in consent:
                errors.append(f"/v1/consents/ai-synthesis is missing {method.upper()}")

    today = paths.get("/v1/readings/today")
    if not isinstance(today, dict):
        errors.append("openapi.yaml does not describe /v1/readings/today")
    else:
        for method in ("get", "put"):
            if method not in today:
                errors.append(f"/v1/readings/today is missing {method.upper()}")
        for status in ("200", "202", "404", "409", "424", "503"):
            if status not in (today.get("put", {}).get("responses") or {}):
                errors.append(f"PUT /v1/readings/today does not document {status}")

    if not any(key.endswith("/evidence") for key in paths):
        errors.append("openapi.yaml does not describe the evidence operation")

    schemas = (spec.get("components") or {}).get("schemas") or {}
    envelope = schemas.get("ErrorResponse") or {}
    error_props = (
        ((envelope.get("properties") or {}).get("error") or {}).get("properties") or {}
    )
    if "retryable" not in error_props:
        errors.append(
            "ErrorResponse carries no retryable flag; the client would have to infer that "
            "every 503 can make progress, and a budget-exhausted one cannot"
        )

    if not errors:
        print("OK  projection    openapi.yaml declares consent, Today, evidence, and retryable")
    return errors


M4_SCHEMA_VERSION = "0.4.0"


def check_m4_manifest() -> list[str]:
    """Check M4's additive inventory and exact frozen predecessor pins."""
    errors: list[str] = []
    path = M4 / "SCHEMA_MANIFEST.json"
    if not path.exists():
        return ["contracts/m4/SCHEMA_MANIFEST.json is missing"]
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("package") != "contracts/m4":
        errors.append("M4 manifest package is not contracts/m4")
    if doc.get("schema_version") != M4_SCHEMA_VERSION:
        errors.append(f"M4 manifest schema_version is not {M4_SCHEMA_VERSION}")

    declared = {entry.get("file"): entry for entry in doc.get("schemas") or []}
    shipped = {p.name: p for p in sorted(M4.glob("*.schema.json"))}
    for missing in sorted(set(shipped) - set(declared)):
        errors.append(f"M4 manifest does not declare shipped schema {missing}")
    for extra in sorted(set(declared) - set(shipped)):
        errors.append(f"M4 manifest declares {extra}, which the package does not ship")
    for filename, entry in declared.items():
        if filename not in shipped:
            continue
        schema = json.loads(shipped[filename].read_text(encoding="utf-8"))
        if entry.get("id") != schema.get("$id"):
            errors.append(f"{filename}: M4 manifest id disagrees with the document $id")
        if sorted(entry.get("defines") or []) != sorted(schema.get("$defs") or {}):
            errors.append(f"{filename}: M4 manifest definition inventory disagrees")

    recorded = _recorded_predecessors(path)
    expected = {
        "contracts/m0": _normalised_manifest_digest(M0),
        "contracts/m3": _normalised_manifest_digest(M3),
    }
    for predecessor, digest in expected.items():
        if recorded.get(predecessor) != digest:
            errors.append(f"M4 manifest does not pin the exact {predecessor} manifest")
    if not errors:
        print(
            f"OK  manifest      contracts/m4 declares {len(declared)} schema(s) "
            "and pins the exact M0/M3 predecessors"
        )
    return errors


def check_m4_openapi_projection() -> list[str]:
    try:
        import yaml
    except ImportError:
        return []
    path = M4 / "openapi" / "openapi.yaml"
    if not path.exists():
        return ["contracts/m4/openapi/openapi.yaml is missing"]
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    paths = spec.get("paths") or {}
    required = {
        "/v1/pattern": {"get"},
        "/v1/time-travel": {"get"},
        "/v1/life-events": {"get", "post"},
        "/v1/life-events/{event_id}": {"put", "delete"},
        "/v1/context-sources": {"get", "put"},
    }
    errors: list[str] = []
    for route, methods in required.items():
        item = paths.get(route)
        if not isinstance(item, dict):
            errors.append(f"M4 OpenAPI does not describe {route}")
            continue
        for method in methods:
            if method not in item:
                errors.append(f"M4 OpenAPI {route} has no {method.upper()}")
    if not errors:
        print("OK  projection    M4 OpenAPI declares Pattern, Time Travel, life events, and context CAS")
    return errors


M6_SCHEMA_VERSION = "0.6.0"


def check_m6_manifest() -> list[str]:
    """Check that the M6 freeze inventory matches the schemas it ships."""
    errors: list[str] = []
    path = M6 / "SCHEMA_MANIFEST.json"
    if not path.exists():
        return ["contracts/m6/SCHEMA_MANIFEST.json is missing"]
    doc = json.loads(path.read_text(encoding="utf-8"))

    if doc.get("package") != "contracts/m6":
        errors.append("M6 manifest package is not contracts/m6")
    if doc.get("schema_version") != M6_SCHEMA_VERSION:
        errors.append(f"M6 manifest schema_version is not {M6_SCHEMA_VERSION}")

    declared = {entry.get("file"): entry for entry in doc.get("schemas") or []}
    shipped = {p.name: p for p in sorted(M6.glob("*.schema.json"))}
    for missing in sorted(set(shipped) - set(declared)):
        errors.append(f"M6 manifest does not declare shipped schema {missing}")
    for extra in sorted(set(declared) - set(shipped)):
        errors.append(f"M6 manifest declares {extra}, which the package does not ship")

    for filename, entry in declared.items():
        if filename not in shipped:
            continue
        schema = json.loads(shipped[filename].read_text(encoding="utf-8"))
        if entry.get("id") != schema.get("$id"):
            errors.append(f"{filename}: M6 manifest id disagrees with the document $id")
        listed = sorted(entry.get("defines") or [])
        actual = sorted(schema.get("$defs") or {})
        if listed != actual:
            errors.append(
                f"{filename}: M6 manifest defines {listed} but the document defines {actual}"
            )

    recorded = _recorded_predecessors(path)
    for predecessor in ("contracts/m0", "contracts/m5"):
        if predecessor not in recorded:
            errors.append(f"M6 manifest records no {predecessor} predecessor")

    if not errors:
        print(
            f"OK  manifest      contracts/m6 declares {len(declared)} schema(s) "
            "and both predecessors"
        )
    return errors


def check_m6_openapi_projection() -> list[str]:
    """Pin the implemented privacy/context routes and their complete status sets."""
    try:
        import yaml
    except ImportError:
        return []

    path = M6 / "openapi" / "openapi.yaml"
    if not path.exists():
        return ["contracts/m6/openapi/openapi.yaml is missing"]
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    expected = {
        ("/v1/exports", "post"): {"202", "400", "401", "403", "409", "503"},
        ("/v1/exports/{export_id}", "get"): {"200", "401", "404"},
        ("/v1/exports/{export_id}/download", "get"): {
            "200", "401", "404", "409", "410", "500"
        },
        ("/v1/account", "delete"): {"202", "400", "401", "403", "409", "503"},
        ("/v1/account/deletion-status", "get"): {"200", "401"},
        ("/v1/context-sources", "get"): {"200", "401", "403"},
        ("/v1/context-sources", "put"): {"200", "400", "401", "403", "409"},
        ("/v1/check-ins", "post"): {"201", "400", "401", "403", "409"},
    }
    errors: list[str] = []
    for (route, method), statuses in expected.items():
        operation = (spec.get("paths", {}).get(route) or {}).get(method)
        if operation is None:
            errors.append(f"M6 OpenAPI does not describe {method.upper()} {route}")
            continue
        actual = set((operation.get("responses") or {}).keys())
        if actual != statuses:
            errors.append(
                f"M6 OpenAPI {method.upper()} {route} responses are "
                f"{sorted(actual)}, expected {sorted(statuses)}"
            )
    if not errors:
        print("OK  projection    M6 OpenAPI declares every privacy/context status")
    return errors


def main() -> int:
    print("== freeze ==")
    freeze_errors = check_predecessors_frozen()
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
    errors += validate_package(registry, "m3", M3, catalogue)
    errors += check_openapi(M3, registry)

    # Every vector file in the directory is checked, not one named file: the
    # cycle-derivation profiles landed in their own file, and a checker that
    # names a single path silently stops covering whatever is added beside it.
    vector_dir = M3 / "fixtures" / "canonicalization"
    vector_files = sorted(vector_dir.glob("*.json"))
    if not any(p.name == "jcs-golden-vectors.json" for p in vector_files):
        errors.append("VECTORS: jcs-golden-vectors.json is missing")
    for vectors in vector_files:
        ve = check_golden_vectors(vectors)
        errors += [f"VECTORS {vectors.name}: {e}" for e in ve]
        for e in ve:
            print(f"FAIL vectors      {vectors.name}: {e}")
        if not ve:
            print(f"OK  vectors       {vectors.name}")

    for vectors in sorted((vector_dir / "invalid").glob("*.json")):
        ve = check_golden_vectors(vectors)
        if not ve:
            errors.append(f"INVALID vector fixture unexpectedly passed {vectors.name}")
            print(f"FAIL invalid vector {vectors.name} (expected a vector failure)")
        else:
            print(f"OK  invalid vector {vectors.name}: {ve[0]}")

    print("\n== contracts/m4 ==")
    errors += validate_package(registry, "m4", M4, set())
    errors += check_openapi(M4, registry)
    errors += check_m4_manifest()
    errors += check_m4_openapi_projection()

    print("\n== contracts/m5 ==")
    errors += validate_package(registry, "m5", M5, set())
    errors += check_openapi(M5, registry)
    errors += check_m5_manifest()
    errors += check_m5_openapi_projection()

    for vectors in sorted((M5 / "fixtures" / "canonicalization").glob("*.json")):
        ve = check_golden_vectors(vectors)
        errors += [f"VECTORS {vectors.name}: {e}" for e in ve]
        for e in ve:
            print(f"FAIL vectors      {vectors.name}: {e}")
        if not ve:
            print(f"OK  vectors       {vectors.name}")

    print("\n== contracts/m6 ==")
    errors += validate_package(registry, "m6", M6, set())
    errors += check_openapi(M6, registry)
    errors += check_m6_manifest()
    errors += check_m6_openapi_projection()

    if errors:
        print(f"\n{len(errors)} error(s)")
        for e in errors:
            print(" -", e)
        return 1
    print("\nAll contract package checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
