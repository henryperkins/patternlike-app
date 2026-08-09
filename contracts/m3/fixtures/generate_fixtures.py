#!/usr/bin/env python3
"""Regenerate the contracts/m3 fixtures and the JCS golden vectors.

The fixtures are the checked-in artifact; this is what keeps every INVALID
fixture exactly one mutation away from its valid twin. Hand-editing a rejection
case is how it quietly starts failing for a different reason than the one it
was written to pin.

The RFC 8785 implementation below is deliberately a SECOND, independent one:
the normative implementation is packages/reading-engine/src/jcs.ts, and
jcs.test.ts asserts byte equality against the vectors produced here. Two
implementations agreeing is evidence; one implementation agreeing with itself
is not.

Usage:
  python contracts/m3/fixtures/generate_fixtures.py
  python contracts/validate_schemas.py                       # revalidate
  npm run test -w @patternlike/reading-engine                 # re-pin the bytes
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parents[1]

SV = "0.3.0"
USER = "usr_01JAMPLEUSER00000001"
READING = "rdg_01JAMPLEREADING00001"
PRED = "rdg_01JAMPLEREADING00000"
FP = "sha256:" + "1a" * 32
BUNDLE_HASH = "sha256:" + "2b" * 32
CONTAINER = "sha256:" + "3c" * 32
CYCLE_CONTAINER = "sha256:" + "4d" * 32
NORM_HASH = "5e" * 32
CYCLE_HASH = "6f" * 32
ANCHOR = "2026-07-30T09:00:00Z"
DATE = "2026-07-30"
TZ = "America/Los_Angeles"
RELEASE = "release-12"
CYC = "cyc_" + "ab" * 16
CYC2 = "cyc_" + "cd" * 16
CYP = ["cyp_" + "e1" * 16, "cyp_" + "e2" * 16, "cyp_" + "e3" * 16]
POLICY_V = "1.4.0"


# --------------------------------------------------------------------------
# RFC 8785 JSON Canonicalization Scheme
# --------------------------------------------------------------------------

ESCAPES = {
    0x08: "\\b",
    0x09: "\\t",
    0x0A: "\\n",
    0x0C: "\\f",
    0x0D: "\\r",
    0x22: '\\"',
    0x5C: "\\\\",
}


def jcs_string(s: str) -> str:
    out = ['"']
    for ch in s:
        cp = ord(ch)
        if cp in ESCAPES:
            out.append(ESCAPES[cp])
        elif cp < 0x20:
            out.append("\\u%04x" % cp)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def jcs_number(v) -> str:
    if isinstance(v, bool):
        raise TypeError("bool is not a number")
    if isinstance(v, int):
        return str(v)
    if not math.isfinite(v):
        raise ValueError("non-finite numbers are not I-JSON")
    if v == int(v) and abs(v) < 1e21:
        return str(int(v))
    return repr(v)


def jcs(value) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return jcs_string(value)
    if isinstance(value, (int, float)):
        return jcs_number(value)
    if isinstance(value, list):
        return "[" + ",".join(jcs(v) for v in value) + "]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda kv: kv[0].encode("utf-16-be"))
        return "{" + ",".join(jcs_string(k) + ":" + jcs(v) for k, v in items) + "}"
    raise TypeError(f"unsupported {type(value)}")


def assembly_id(preimage: dict) -> tuple[str, str, str]:
    canonical = jcs(preimage)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return canonical, digest, "asm_" + digest[:32]


def cycle_id_of(preimage: dict) -> tuple[str, str, str]:
    canonical = jcs(preimage)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return canonical, digest, "cyc_" + digest[:32]


# --------------------------------------------------------------------------
# Shared building blocks
# --------------------------------------------------------------------------

UNCERTAINTY_EXACT = {
    "accuracy": "exact",
    "window_plus_minus_minutes": None,
    "suppressed_features": [],
    "qualified_features": [],
}

UNCERTAINTY_UNKNOWN = {
    "accuracy": "unknown",
    "window_plus_minus_minutes": None,
    "suppressed_features": [
        {"feature_class": "angle_transits", "feature_id": None, "reason": "unknown_birth_time"},
        {"feature_class": "angles", "feature_id": None, "reason": "unknown_birth_time"},
        {"feature_class": "houses", "feature_id": None, "reason": "unknown_birth_time"},
        {"feature_class": "moon_time_sensitive", "feature_id": None, "reason": "unknown_birth_time"},
    ],
    "qualified_features": [],
}

FACT_PRIMARY = {
    "id": CYC,
    "fact_class": "cycle_instance",
    "technique": "transit",
    "body": "saturn",
    "target": "sun",
    "aspect": "square",
    "phase": "building",
    "orb_deg": 0.42,
    "first_exact_at": "2026-08-02T14:11:07Z",
    "pass_count": 3,
}

FACT_SUPPORT = {
    "id": CYC2,
    "fact_class": "cycle_instance",
    "technique": "transit",
    "body": "venus",
    "target": "moon",
    "aspect": "trine",
    "phase": "peak",
    "orb_deg": 1.10,
    "first_exact_at": "2026-07-30T22:40:00Z",
    "pass_count": 1,
}

CONTEXT_SIGNAL = {
    "signal_id": "sig_01JAMPLESIGNAL000001",
    "source_id": "USR-03",
    "allowed_use": "life_domain_selection",
    "evidence_lane": "user_and_context",
    "normalized_hash": NORM_HASH,
}


def identity(**over) -> dict:
    base = {
        "identity_profile": "patternlike.assembly-id.v1",
        "schema_version": SV,
        "assembly_policy_id": "daily-reading-deterministic",
        "assembly_policy_version": POLICY_V,
        "output_schema": "daily-reading-v3",
        "local_date": DATE,
        "target_timezone": TZ,
        "generation_anchor": ANCHOR,
        "chart_fingerprint": FP,
        "effective_accuracy": "exact",
        "uncertainty": copy.deepcopy(UNCERTAINTY_EXACT),
        "facts": [copy.deepcopy(FACT_SUPPORT), copy.deepcopy(FACT_PRIMARY)],
        "release_version": RELEASE,
        "release_bundle_hash": BUNDLE_HASH,
        "context": [copy.deepcopy(CONTEXT_SIGNAL)],
        "locale": "en-US",
        "domain_preference": "work",
        "revision": 1,
    }
    base.update(over)
    return base


IDENTITY_DAILY = identity()
_, _, ASM_DAILY = assembly_id(IDENTITY_DAILY)

IDENTITY_ZERO = identity(facts=[], context=[], domain_preference=None)
_, _, ASM_ZERO = assembly_id(IDENTITY_ZERO)

IDENTITY_UNKNOWN = identity(
    effective_accuracy="unknown",
    uncertainty=copy.deepcopy(UNCERTAINTY_UNKNOWN),
    facts=[],
    context=[],
    domain_preference=None,
)
_, _, ASM_UNKNOWN = assembly_id(IDENTITY_UNKNOWN)

CYCLE_IDENTITY = {
    "identity_profile": "patternlike.cycle-id.v1",
    "chart_fingerprint": FP,
    "technique": "transit",
    "body": "saturn",
    "target": "sun",
    "aspect": "square",
    "oriented_branch": "plus",
    "winding": 3,
    "contract_id": "patternlike.chart.launch",
    "contract_version": "0.2.0",
    "cycle_policy_id": "transit-scan-launch",
    "cycle_policy_version": POLICY_V,
    "orb_policy_id": "orb-launch",
    "orb_policy_version": "1.0.0",
    "container_digest": CYCLE_CONTAINER,
    "ephemeris_data_version": "se-2.10.03-1800-2399",
}
_, _, CYC_REAL = cycle_id_of(CYCLE_IDENTITY)


def write(rel: str, obj) -> None:
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", rel)


V = "fixtures/valid/"
I = "fixtures/invalid/"

# --------------------------------------------------------------------------
# assembly-identity
# --------------------------------------------------------------------------
write(V + "assembly-identity.daily.json", IDENTITY_DAILY)
write(V + "assembly-identity.zero-facts.json", IDENTITY_ZERO)
write(V + "assembly-identity.unknown-time.json", IDENTITY_UNKNOWN)

bad = copy.deepcopy(IDENTITY_DAILY)
del bad["assembly_policy_version"]
write(I + "assembly-identity.missing-policy-version.json", bad)

bad = copy.deepcopy(IDENTITY_DAILY)
del bad["uncertainty"]
write(I + "assembly-identity.missing-uncertainty.json", bad)

bad = copy.deepcopy(IDENTITY_DAILY)
bad["reading_key"] = f"user:{USER}:{DATE}:{RELEASE}:r1"
write(I + "assembly-identity.carries-reading-key.json", bad)

# accuracy mirror: schema-valid, policy-invalid
bad = copy.deepcopy(IDENTITY_DAILY)
bad["effective_accuracy"] = "unknown"
write(I + "assembly-identity.accuracy-mismatch.json", bad)

# --------------------------------------------------------------------------
# reading-assembly
# --------------------------------------------------------------------------
ASSEMBLY_REQUEST = {
    "schema_version": SV,
    "assembly_id": ASM_DAILY,
    "output_schema": "daily-reading-v3",
    "facts": [
        {"id": CYC, "phase": "building", "orb": 0.42},
        {"id": CYC2, "phase": "peak", "orb": 1.10},
    ],
    "approved_fragments": [
        "phase.saturn-square-sun.building",
        "prompt.work.steady-effort",
        "timing.default.en-US",
    ],
    "context": [
        {
            "signal_id": "sig_01JAMPLESIGNAL000001",
            "allowed_use": "life_domain_selection",
            "framing": "work",
        }
    ],
    "locale": "en-US",
    "domain_preference": "work",
}
write(V + "reading-assembly.request.json", ASSEMBLY_REQUEST)

zero = {
    "schema_version": SV,
    "assembly_id": ASM_ZERO,
    "output_schema": "daily-reading-v3",
    "facts": [],
    "approved_fragments": [],
    "context": [],
    "locale": "en-US",
    "domain_preference": None,
}
write(V + "reading-assembly.zero-facts.json", zero)

bad = copy.deepcopy(ASSEMBLY_REQUEST)
bad["reading_key"] = f"user:{USER}:{DATE}:{RELEASE}:r1"
write(I + "reading-assembly.carries-reading-key.json", bad)

bad = copy.deepcopy(ASSEMBLY_REQUEST)
bad["user_id"] = USER
write(I + "reading-assembly.carries-user-id.json", bad)

bad = copy.deepcopy(ASSEMBLY_REQUEST)
bad["output_schema"] = "daily-reading-v2"
write(I + "reading-assembly.stale-output-schema.json", bad)

# --------------------------------------------------------------------------
# cycle-identity / request / response
# --------------------------------------------------------------------------
write(V + "cycle-identity.transit.json", CYCLE_IDENTITY)

bad = copy.deepcopy(CYCLE_IDENTITY)
del bad["winding"]
write(I + "cycle-identity.missing-winding.json", bad)

CYCLE_REQUEST = {
    "schema_version": SV,
    "request_id": "req_01JAMPLECYCLEREQ0001",
    "chart_fingerprint": FP,
    "natal_positions": [
        {"body": "sun", "longitude_deg": 127.483921},
        {"body": "moon", "longitude_deg": 12.004311},
        {"body": "saturn", "longitude_deg": 301.774002},
    ],
    "natal_accuracy": "exact",
    "suppressed_features": [],
    "window": {"from": "2026-07-30T07:00:00Z", "to": "2026-07-31T07:00:00Z"},
    "techniques": ["transits"],
    "cycle_policy_id": "transit-scan-launch",
    "cycle_policy_version": POLICY_V,
    "orb_policy_id": "orb-launch",
    "orb_policy_version": "1.0.0",
    "contract_id": "patternlike.chart.launch",
    "contract_version": "0.2.0",
}
write(V + "cycle-request.transits.json", CYCLE_REQUEST)

bad = copy.deepcopy(CYCLE_REQUEST)
bad["birth_time_local"] = "07:42"
write(I + "cycle-request.carries-birth-data.json", bad)

bad = copy.deepcopy(CYCLE_REQUEST)
bad["techniques"] = ["transits", "lunations_eclipses"]
write(I + "cycle-request.unimplemented-technique.json", bad)

PASSES = [
    {
        "pass_index": 1,
        "direction": "direct",
        "exact_at": "2026-08-02T14:11:07Z",
        "speed_deg_per_day": 0.0331,
    },
    {
        "pass_index": 2,
        "direction": "retrograde",
        "exact_at": "2026-10-19T03:52:44Z",
        "speed_deg_per_day": -0.0288,
    },
    {
        "pass_index": 3,
        "direction": "direct",
        "exact_at": "2027-01-11T21:07:19Z",
        "speed_deg_per_day": 0.0302,
    },
]

RETRO_CYCLE = {
    "id": CYC_REAL,
    "technique": "transit",
    "body": "saturn",
    "target": "sun",
    "aspect": "square",
    "start_at": "2026-07-19T05:22:10Z",
    "exact_at": "2026-08-02T14:11:07Z",
    "end_at": "2027-01-26T18:44:02Z",
    "pass_count": 3,
    "passes": copy.deepcopy(PASSES),
    "orb_deg": 3.0,
    "importance_score": 0.82,
}

CYCLE_RESPONSE = {
    "ok": True,
    "schema_version": SV,
    "request_id": "req_01JAMPLECYCLEREQ0001",
    "chart_fingerprint": FP,
    "cycle_policy_id": "transit-scan-launch",
    "cycle_policy_version": POLICY_V,
    "orb_policy_id": "orb-launch",
    "orb_policy_version": "1.0.0",
    "contract_id": "patternlike.chart.launch",
    "contract_version": "0.2.0",
    "container_digest": CYCLE_CONTAINER,
    "ephemeris_data_version": "se-2.10.03-1800-2399",
    "cycles": [copy.deepcopy(RETRO_CYCLE)],
}
write(V + "cycle-response.retrograde.json", CYCLE_RESPONSE)

empty = copy.deepcopy(CYCLE_RESPONSE)
empty["cycles"] = []
write(V + "cycle-response.empty.json", empty)

write(
    V + "cycle-response.incomplete.json",
    {
        "ok": False,
        "schema_version": SV,
        "request_id": "req_01JAMPLECYCLEREQ0001",
        "error_class": "cycle_window_incomplete",
        "error_message": "encounter boundaries not proven within the policy lookaround limit",
    },
)


def mutate_cycle(name, fn, invalid=True):
    doc = copy.deepcopy(CYCLE_RESPONSE)
    fn(doc["cycles"][0])
    write((I if invalid else V) + name, doc)


def _unordered(c):
    c["passes"][1]["exact_at"], c["passes"][2]["exact_at"] = (
        c["passes"][2]["exact_at"],
        c["passes"][1]["exact_at"],
    )


mutate_cycle("cycle-response.unordered-passes.json", _unordered)
mutate_cycle(
    "cycle-response.noncontiguous-index.json",
    lambda c: c["passes"][2].__setitem__("pass_index", 4),
)
mutate_cycle(
    "cycle-response.count-mismatch.json", lambda c: c.__setitem__("pass_count", 2)
)
mutate_cycle(
    "cycle-response.first-exact-mismatch.json",
    lambda c: c.__setitem__("exact_at", "2026-10-19T03:52:44Z"),
)
mutate_cycle(
    "cycle-response.pass-outside-envelope.json",
    lambda c: c.__setitem__("end_at", "2026-09-01T00:00:00Z"),
)

bad = copy.deepcopy(CYCLE_RESPONSE)
bad["cycles"][0]["passes"][0]["direction"] = "stationary"
write(I + "cycle-response.bad-direction.json", bad)

# A second cycle, so the response-level rules -- ordering by (exact_at, id) and
# id uniqueness -- have a fixture at all. Every response fixture above carries
# zero or one cycle, which cannot exercise either rule.
#
# The minus branch of the same square is a genuinely different encounter, so its
# identity really does differ in exactly one member.
CYCLE_IDENTITY_MINUS = copy.deepcopy(CYCLE_IDENTITY)
CYCLE_IDENTITY_MINUS["oriented_branch"] = "minus"
_, _, CYC_MINUS = cycle_id_of(CYCLE_IDENTITY_MINUS)

EARLIER_CYCLE = {
    "id": CYC_MINUS,
    "technique": "transit",
    "body": "saturn",
    "target": "sun",
    "aspect": "square",
    "start_at": "2025-11-02T09:14:55Z",
    "exact_at": "2025-12-08T22:03:41Z",
    "end_at": "2026-01-14T06:30:12Z",
    "pass_count": 1,
    "passes": [
        {
            "pass_index": 1,
            "direction": "direct",
            "exact_at": "2025-12-08T22:03:41Z",
            "speed_deg_per_day": 0.0345,
        }
    ],
    "orb_deg": 3.0,
    "importance_score": 0.41,
}

MULTI_RESPONSE = copy.deepcopy(CYCLE_RESPONSE)
MULTI_RESPONSE["cycles"] = [
    copy.deepcopy(EARLIER_CYCLE),
    copy.deepcopy(RETRO_CYCLE),
]
write(V + "cycle-response.multi.json", MULTI_RESPONSE)


def mutate_multi(name, fn):
    doc = copy.deepcopy(MULTI_RESPONSE)
    fn(doc)
    write(I + name, doc)


mutate_multi(
    "cycle-response.unordered-cycles.json",
    lambda d: d["cycles"].reverse(),
)
mutate_multi(
    "cycle-response.duplicate-cycle-ids.json",
    lambda d: d["cycles"][1].__setitem__("id", d["cycles"][0]["id"]),
)


def _invert_envelope(c):
    c["start_at"], c["end_at"] = c["end_at"], c["start_at"]


mutate_cycle("cycle-response.inverted-envelope.json", _invert_envelope)

# --------------------------------------------------------------------------
# generation-command
# --------------------------------------------------------------------------
COMMAND = {
    "command_version": "v1",
    "schema_version": SV,
    "reading_id": READING,
    "reading_key": f"user:{USER}:{DATE}:{RELEASE}:r1",
    "revision": 1,
    "revision_reason": "initial",
    "supersedes_reading_id": None,
    "command_generation": 1,
    "replaces_job_id": None,
    "command_replacement_reason": None,
    "target_local_date": DATE,
    "target_timezone": TZ,
    "timezone_revision": 2,
    "day_start_at": "2026-07-30T07:00:00Z",
    "day_end_at": "2026-07-31T07:00:00Z",
    "generation_anchor": ANCHOR,
    "locale": "en-US",
    "domain_preference": "work",
    "identity_profile": "patternlike.assembly-id.v1",
    "output_schema": "daily-reading-v3",
    "assembly_policy_id": "daily-reading-deterministic",
    "assembly_policy_version": POLICY_V,
    "chart": {
        "snapshot_id": "cht_01JAMPLECHART0000001",
        "fingerprint": FP,
        "profile_version": 1,
        "contract_id": "patternlike.chart.launch",
        "contract_version": "0.2.0",
        "container_digest": CONTAINER,
        "tzdb_version": "2026a",
        "effective_accuracy": "exact",
        "uncertainty": copy.deepcopy(UNCERTAINTY_EXACT),
    },
    "cycle_scan": {
        "cycles": [
            {"cycle_id": CYC_REAL, "pass_ids": CYP, "cycle_hash": CYCLE_HASH}
        ],
        "cycle_policy_id": "transit-scan-launch",
        "cycle_policy_version": POLICY_V,
        "orb_policy_id": "orb-launch",
        "orb_policy_version": "1.0.0",
        "container_digest": CYCLE_CONTAINER,
        "ephemeris_data_version": "se-2.10.03-1800-2399",
    },
    "release_version": RELEASE,
    "release_bundle_hash": BUNDLE_HASH,
    "context": [
        {
            "signal_id": "sig_01JAMPLESIGNAL000001",
            "source_id": "USR-03",
            "normalized_hash": NORM_HASH,
            "allowed_use": "life_domain_selection",
            "evidence_lane": "user_and_context",
            "consent_id": "cns_01JAMPLECONSENT00001",
            "consent_version": 1,
            "permission_state": "active",
            "freshness_status": "fresh",
        }
    ],
    "assembly_id": ASM_DAILY,
}
write(V + "generation-command.initial.json", COMMAND)

repl = copy.deepcopy(COMMAND)
repl["command_generation"] = 2
repl["replaces_job_id"] = "job_01JAMPLEJOBFAILED001"
repl["command_replacement_reason"] = "calc_unavailable"
write(V + "generation-command.replacement.json", repl)

reissue = copy.deepcopy(COMMAND)
reissue["revision"] = 2
reissue["revision_reason"] = "safety_correction"
reissue["supersedes_reading_id"] = PRED
reissue["reading_key"] = f"user:{USER}:{DATE}:{RELEASE}:r2"
write(V + "generation-command.reissue.json", reissue)

bad = copy.deepcopy(COMMAND)
del bad["release_bundle_hash"]
write(I + "generation-command.missing-release-hash.json", bad)

bad = copy.deepcopy(COMMAND)
del bad["cycle_scan"]["ephemeris_data_version"]
write(I + "generation-command.missing-ephemeris-version.json", bad)

bad = copy.deepcopy(COMMAND)
bad["revision"] = 2
write(I + "generation-command.initial-with-revision-two.json", bad)

bad = copy.deepcopy(COMMAND)
bad["command_generation"] = 2
write(I + "generation-command.replacement-without-predecessor-job.json", bad)

# --------------------------------------------------------------------------
# daily-reading output
# --------------------------------------------------------------------------
PREPARATION_DOC = {
    "schema_version": SV,
    "status": "preparing",
    "local_date": DATE,
}
write(V + "daily-reading-preparation.preparing.json", PREPARATION_DOC)

READING_DOC = {
    "schema_version": SV,
    "output_schema": "daily-reading-v3",
    "reading_id": READING,
    "local_date": DATE,
    "generated_at": ANCHOR,
    "assembly_mode": "deterministic",
    "revision": 1,
    "locale": "en-US",
    "domain_preference": "work",
    "fallback_used": False,
    "paragraphs": [
        {
            "paragraph_id": "par_01JAMPLEPARAGRAPH001",
            "role": "primary_theme",
            "order": 1,
            "text": "Steady pressure asks for a smaller, firmer commitment than the one you had in mind.",
        },
        {
            "paragraph_id": "par_01JAMPLEPARAGRAPH002",
            "role": "phase_context",
            "order": 2,
            "text": "This is the building stretch: the shape is set, the work is repetition.",
        },
        {
            "paragraph_id": "par_01JAMPLEPARAGRAPH003",
            "role": "timing",
            "order": 3,
            "text": "Closest on 2026-08-02, easing by 2027-01-26.",
        },
        {
            "paragraph_id": "par_01JAMPLEPARAGRAPH004",
            "role": "reflection",
            "order": 4,
            "text": "What would you keep doing if no one noticed for a month?",
        },
    ],
}
write(V + "daily-reading.published.json", READING_DOC)

FALLBACK_DOC = {
    "schema_version": SV,
    "output_schema": "daily-reading-v3",
    "reading_id": READING,
    "local_date": DATE,
    "generated_at": ANCHOR,
    "assembly_mode": "deterministic",
    "revision": 1,
    "locale": "en-US",
    "domain_preference": None,
    "fallback_used": True,
    "paragraphs": [
        {
            "paragraph_id": "par_01JAMPLEFALLBACK0001",
            "role": "safety_fallback",
            "order": 1,
            "text": "Nothing in the sky is pressing on your chart today. A quiet day is still a day worth noticing.",
        }
    ],
}
write(V + "daily-reading.fallback.json", FALLBACK_DOC)

bad = copy.deepcopy(FALLBACK_DOC)
bad["paragraphs"].append(
    {
        "paragraph_id": "par_01JAMPLEPARAGRAPH009",
        "role": "primary_theme",
        "order": 2,
        "text": "A theme that should not exist alongside a fallback.",
    }
)
write(I + "daily-reading.fallback-with-theme.json", bad)

bad = copy.deepcopy(READING_DOC)
bad["paragraphs"] = []
write(I + "daily-reading.empty-paragraphs.json", bad)

# --------------------------------------------------------------------------
# reading-evidence
# --------------------------------------------------------------------------
CONTENT_PHASE = {
    "fragment_id": "phase.saturn-square-sun.building",
    "content_version": "3",
    "release_version": RELEASE,
    "content_type": "astrology_phase",
    "bundle_hash": BUNDLE_HASH,
}
CONTENT_TIMING = {
    "fragment_id": "timing.default.en-US",
    "content_version": "1",
    "release_version": RELEASE,
    "content_type": "timing_template",
    "bundle_hash": BUNDLE_HASH,
}
FACT_REF = {
    "id": CYC_REAL,
    "fact_type": "cycle_instance",
    "phase": "building",
    "orb_deg": 0.42,
    "chart_fingerprint": FP,
    "technique": "transit",
    "pass_index": 1,
}

EVIDENCE = {
    "schema_version": SV,
    "reading_id": READING,
    "reading_key": f"user:{USER}:{DATE}:{RELEASE}:r1",
    "user_id": USER,
    "local_date": DATE,
    "release_version": RELEASE,
    "chart_fingerprint": FP,
    "contract_id": "patternlike.chart.launch",
    "contract_version": "0.2.0",
    "assembly_mode": "deterministic",
    "assembly_id": ASM_DAILY,
    "assembly_policy_version": POLICY_V,
    "revision": 1,
    "revision_reason": "initial",
    "supersedes_reading_id": None,
    "primary_theme": {
        "cycle_id": CYC_REAL,
        "phase": "building",
        "fragment_ids": ["phase.saturn-square-sun.building"],
    },
    "supporting_theme": None,
    "content_hash": "sha256:" + "7a" * 32,
    "created_at": ANCHOR,
    "validation": {
        "passed": True,
        "fallback_used": False,
        "checks": [
            {"check": "schema", "result": "pass", "detail_code": None},
            {"check": "provenance", "result": "pass", "detail_code": None},
            {"check": "dates", "result": "pass", "detail_code": None},
            {"check": "unsupported_facts", "result": "pass", "detail_code": None},
            {"check": "eligibility_allowlist", "result": "pass", "detail_code": None},
            {"check": "uncertainty_constraints", "result": "pass", "detail_code": None},
            {"check": "consent_freshness", "result": "pass", "detail_code": None},
            {"check": "repetition", "result": "pass", "detail_code": None},
            {"check": "source_laundering", "result": "pass", "detail_code": None},
            {"check": "fatalism", "result": "skip", "detail_code": "deterministic_mode"},
            {"check": "diagnosis", "result": "skip", "detail_code": "deterministic_mode"},
        ],
    },
    "paragraphs": [
        {
            "paragraph_id": "par_01JAMPLEPARAGRAPH001",
            "role": "primary_theme",
            "order": 1,
            "evidence_lane": "celestial_facts",
            "text_hash": "sha256:" + "8b" * 32,
            "facts": [copy.deepcopy(FACT_REF)],
            "content": [copy.deepcopy(CONTENT_PHASE)],
            "context_signals": [],
            "ranking_factors": [
                {"factor": "exactness", "weight": 0.51, "reason": "orb_0_42_within_peak_band"},
                {"factor": "body_importance", "weight": 0.24, "reason": "outer_body_saturn"},
                {"factor": "domain_match", "weight": 0.15, "reason": "preference_work"},
            ],
            "model_output": None,
        },
        {
            "paragraph_id": "par_01JAMPLEPARAGRAPH003",
            "role": "timing",
            "order": 3,
            "evidence_lane": "celestial_facts",
            "text_hash": "sha256:" + "9c" * 32,
            "facts": [copy.deepcopy(FACT_REF)],
            "content": [copy.deepcopy(CONTENT_TIMING)],
            "context_signals": [],
            "ranking_factors": [],
            "model_output": None,
        },
    ],
}
write(V + "reading-evidence.daily.json", EVIDENCE)

FALLBACK_EVIDENCE = copy.deepcopy(EVIDENCE)
FALLBACK_EVIDENCE["assembly_id"] = ASM_ZERO
FALLBACK_EVIDENCE["primary_theme"] = None
FALLBACK_EVIDENCE["validation"]["fallback_used"] = True
FALLBACK_EVIDENCE["paragraphs"] = [
    {
        "paragraph_id": "par_01JAMPLEFALLBACK0001",
        "role": "safety_fallback",
        "order": 1,
        "evidence_lane": "operational",
        "text_hash": "sha256:" + "ad" * 32,
        "facts": [],
        "content": [
            {
                "fragment_id": "fallback.daily.en-US",
                "content_version": "2",
                "release_version": RELEASE,
                "content_type": "fallback_copy",
                "bundle_hash": BUNDLE_HASH,
            }
        ],
        "context_signals": [],
        "ranking_factors": [],
        "model_output": None,
    }
]
write(V + "reading-evidence.fallback.json", FALLBACK_EVIDENCE)

reissue_ev = copy.deepcopy(EVIDENCE)
reissue_ev["revision"] = 2
reissue_ev["revision_reason"] = "safety_correction"
reissue_ev["supersedes_reading_id"] = PRED
reissue_ev["reading_key"] = f"user:{USER}:{DATE}:{RELEASE}:r2"
write(V + "reading-evidence.reissue.json", reissue_ev)

bad = copy.deepcopy(EVIDENCE)
bad["paragraphs"][1]["content"] = []
write(I + "reading-evidence.timing-without-template.json", bad)

bad = copy.deepcopy(EVIDENCE)
bad["paragraphs"][0]["ranking_factors"].append(
    {"factor": "resonance_feedback", "weight": 0.4, "reason": "user_liked_similar"}
)
write(I + "reading-evidence.engagement-ranking.json", bad)

bad = copy.deepcopy(EVIDENCE)
bad["revision"] = 2
write(I + "reading-evidence.initial-with-predecessorless-revision.json", bad)

bad = copy.deepcopy(FALLBACK_EVIDENCE)
bad["paragraphs"][0]["facts"] = [copy.deepcopy(FACT_REF)]
write(I + "reading-evidence.fallback-with-facts.json", bad)

bad = copy.deepcopy(EVIDENCE)
bad["reading_key"] = f"user:{USER}:{DATE}:{RELEASE}"
write(I + "reading-evidence.reading-key-without-revision.json", bad)

# --------------------------------------------------------------------------
# content-release
# --------------------------------------------------------------------------
def obj_hash(n):
    return "sha256:" + (n * 32)


PHASE_OBJ = {
    "id": "phase.saturn-square-sun.building",
    "content_type": "astrology_phase",
    "content_version": "3",
    "title": "Saturn square Sun — building",
    "locale": "en-US",
    "object_hash": obj_hash("b1"),
    "status": "approved",
    "parent_cycle_id": "cycle.saturn-square-sun",
    "phase": "building",
    "summary": "Steady pressure asks for a smaller, firmer commitment than the one you had in mind.",
    "constructive_expression": "Choose one obligation and meet it exactly.",
    "shadow_expression": "Grinding at something you have already outgrown.",
    "prohibited_claims": ["guaranteed_prediction"],
    "eligibility": {
        "required_fact_classes": ["cycle_instance"],
        "required_bodies": ["saturn", "sun"],
        "required_aspects": ["square"],
        "min_birth_time_accuracy": "approximate",
        "requires_houses": False,
        "techniques": ["transit"],
    },
    "tags": ["work"],
}

CYCLE_OBJ = {
    "id": "cycle.saturn-square-sun",
    "content_type": "astrology_cycle",
    "content_version": "3",
    "title": "Saturn square Sun",
    "locale": "en-US",
    "object_hash": obj_hash("b2"),
    "status": "approved",
    "prohibited_claims": ["guaranteed_prediction", "diagnose_or_treat"],
    "technique": "transit",
    "bodies": ["saturn"],
    "targets": ["sun"],
    "aspect": "square",
    "orb_policy_id": "orb-launch",
    "themes": ["effort", "structure"],
    "phase_ids": ["phase.saturn-square-sun.building"],
    "tags": ["work"],
}

SAFETY_OBJ = {
    "id": "safety.no-fatalism",
    "content_type": "astrology_safety_rule",
    "content_version": "1",
    "title": "No fatalistic framing",
    "locale": "en-US",
    "object_hash": obj_hash("b3"),
    "status": "approved",
    "rule_id": "SR-001",
    "trigger_class": "fatalism",
    "action": "replace_paragraph",
    "fallback_fragment_id": "fallback.daily.en-US",
    "fallback_text": None,
}


def prompt_obj(locale, suffix, text):
    return {
        "id": f"prompt.work.steady-effort.{locale}",
        "content_type": "astrology_prompt",
        "content_version": "1",
        "title": f"Steady effort ({locale})",
        "locale": locale,
        "object_hash": obj_hash(suffix),
        "status": "approved",
        "prompt_text": text,
        "intensity": "standard",
        "theme": "effort",
        "life_domains": ["work", "self"],
        "exclusions": [],
    }


def uncertainty_modifier(locale, suffix, body):
    return {
        "id": f"modifier.uncertainty.{locale}",
        "content_type": "astrology_modifier",
        "content_version": "1",
        "title": f"Uncertain birth time notice ({locale})",
        "locale": locale,
        "object_hash": obj_hash(suffix),
        "status": "approved",
        "modifier_kind": "uncertainty",
        "body": body,
        "precedence": 10,
        "eligibility": {},
        "allowed_combinations": ["any"],
        "life_domains": [],
    }


def timing_tpl(locale, suffix, default=True):
    return {
        "id": f"timing.default.{locale}",
        "content_type": "timing_template",
        "content_version": "1",
        "title": f"Default timing sentence ({locale})",
        "locale": locale,
        "object_hash": obj_hash(suffix),
        "status": "approved",
        "template_text": "Closest on {exact_date}, easing by {end_date}.",
        "placeholders": ["exact_date", "end_date"],
        "is_locale_default": default,
        "tags": [],
    }


def fallback_obj(locale, suffix, body):
    return {
        "id": f"fallback.daily.{locale}",
        "content_type": "daily_fallback",
        "content_version": "2",
        "title": f"Universal daily fallback ({locale})",
        "locale": locale,
        "object_hash": obj_hash(suffix),
        "status": "approved",
        "body": body,
        "eligibility_mode": "universal",
        "prohibited_claims": ["guaranteed_prediction"],
    }


BUNDLE = {
    "schema_version": SV,
    "release": {
        "version": RELEASE,
        "bundle_hash": BUNDLE_HASH,
        "created_at": "2026-07-01T12:00:00Z",
        "approver_id": "wp-editor-2",
        "last_author_id": "wp-editor-1",
        "changelog": "Add locale-bound timing templates and universal daily fallbacks (M3).",
        "status": "active",
        "supported_locales": ["en-US", "es-ES"],
        "locale_default": "en-US",
        "language_fallbacks": {"es-MX": "es-ES"},
        "wordpress_site_id": None,
        "calc_contract_id": "patternlike.chart.launch",
    },
    "objects": {
        "patterns": [],
        "cycles": [CYCLE_OBJ],
        "phases": [PHASE_OBJ],
        "modifiers": [
            uncertainty_modifier(
                "en-US",
                "d1",
                "Your birth time is approximate, so Moon and house claims are held loosely today.",
            ),
            uncertainty_modifier(
                "es-ES",
                "d2",
                "Tu hora de nacimiento es aproximada, así que las afirmaciones sobre la Luna y las casas se matizan.",
            ),
        ],
        "prompts": [
            prompt_obj(
                "en-US", "d3", "What would you keep doing if no one noticed for a month?"
            ),
            prompt_obj(
                "es-ES", "d4", "¿Qué seguirías haciendo si nadie lo notara durante un mes?"
            ),
        ],
        "safety_rules": [SAFETY_OBJ],
        "timing_templates": [timing_tpl("en-US", "c1"), timing_tpl("es-ES", "c2")],
        "daily_fallbacks": [
            fallback_obj(
                "en-US",
                "c3",
                "Nothing in the sky is pressing on your chart today. A quiet day is still a day worth noticing.",
            ),
            fallback_obj(
                "es-ES",
                "c4",
                "Hoy nada en el cielo presiona tu carta. Un día tranquilo también merece atención.",
            ),
        ],
    },
    "signature": {
        "alg": "Ed25519",
        "key_id": "wp-release-key-1",
        "signature": "c2lnbmF0dXJlLXBsYWNlaG9sZGVy",
        "signed_payload_hash": BUNDLE_HASH,
    },
    "fixtures": [
        {"fixture_id": "saturn-square-sun-building", "expect": "eligible"},
        {"fixture_id": "quiet-day-no-cycles", "expect": "fallback"},
        {"fixture_id": "unknown-time-angle-theme", "expect": "ineligible"},
    ],
}
write(V + "content-release.bundle.json", BUNDLE)

bad = copy.deepcopy(BUNDLE)
bad["release"]["locale_default"] = "fr-FR"
write(I + "content-release.locale-default-not-supported.json", bad)

bad = copy.deepcopy(BUNDLE)
bad["objects"]["daily_fallbacks"] = [bad["objects"]["daily_fallbacks"][0]]
write(I + "content-release.fallback-missing-for-locale.json", bad)

bad = copy.deepcopy(BUNDLE)
dup = copy.deepcopy(bad["objects"]["daily_fallbacks"][0])
dup["id"] = "fallback.daily.en-US.alt"
dup["object_hash"] = obj_hash("c5")
bad["objects"]["daily_fallbacks"].append(dup)
write(I + "content-release.fallback-duplicate-for-locale.json", bad)

bad = copy.deepcopy(BUNDLE)
bad["objects"]["daily_fallbacks"][0]["locale"] = "de-DE"
write(I + "content-release.fallback-locale-mismatch.json", bad)

bad = copy.deepcopy(BUNDLE)
bad["objects"]["daily_fallbacks"][0]["eligibility_mode"] = "conditional"
write(I + "content-release.fallback-not-universal.json", bad)

bad = copy.deepcopy(BUNDLE)
bad["objects"]["timing_templates"] = [bad["objects"]["timing_templates"][0]]
write(I + "content-release.timing-template-missing-for-locale.json", bad)

bad = copy.deepcopy(BUNDLE)
bad["objects"]["timing_templates"][0]["template_text"] = "Closest on {exact_date}, easing by {sunset}."
write(I + "content-release.timing-undeclared-placeholder.json", bad)

bad = copy.deepcopy(BUNDLE)
bad["objects"]["timing_templates"][0]["template_text"] = "Closest on {}, easing by {end_date}."
write(I + "content-release.timing-malformed-placeholder.json", bad)

for suffix, template_text in (
    ("nested-placeholder", "Closest on {{exact_date}}."),
    ("residual-closing-brace", "Closest on {exact_date} }."),
    ("unmatched-opening-brace", "Closest on {exact_date."),
):
    bad = copy.deepcopy(BUNDLE)
    bad["objects"]["timing_templates"][0]["template_text"] = template_text
    write(I + f"content-release.timing-{suffix}.json", bad)

bad = copy.deepcopy(BUNDLE)
bad["release"]["approver_id"] = bad["release"]["last_author_id"]
write(I + "content-release.same-author.json", bad)

# --------------------------------------------------------------------------
# Assembly fixture catalogue (D5)
# --------------------------------------------------------------------------
def catalogue(fixture_id, expect, cycles, accuracy="exact", uncertainty=None, locale="en-US"):
    """One complete engine input minus the release, which is the bundle under test.

    D5: `contracts/m3/fixtures/assembly/<fixture_id>.json` holds the input side.
    Ingestion resolves each declared fixture_id against this catalogue; an
    unknown id is a rejection (fixtures_unknown), not a pass.
    """
    return {
        "schema_version": SV,
        "fixture_id": fixture_id,
        "expect": expect,
        "locale": locale,
        "domain_preference": None,
        "local_date": DATE,
        "target_timezone": "UTC",
        "day_start_at": "2026-07-30T00:00:00Z",
        "day_end_at": "2026-07-31T00:00:00Z",
        "chart": {
            "fingerprint": FP,
            "effective_accuracy": accuracy,
            "uncertainty": uncertainty or copy.deepcopy(UNCERTAINTY_EXACT),
        },
        "cycles": cycles,
        "context": [],
    }


write(
    "fixtures/assembly/saturn-square-sun-building.json",
    catalogue("saturn-square-sun-building", "eligible", [copy.deepcopy(RETRO_CYCLE)]),
)
write(
    "fixtures/assembly/quiet-day-no-cycles.json",
    catalogue("quiet-day-no-cycles", "fallback", []),
)
angle_cycle = copy.deepcopy(RETRO_CYCLE)
angle_cycle["target"] = "ascendant"
angle_cycle["id"] = "cyc_" + "f0" * 16
write(
    "fixtures/assembly/unknown-time-angle-theme.json",
    catalogue(
        "unknown-time-angle-theme",
        "ineligible",
        [angle_cycle],
        accuracy="unknown",
        uncertainty=copy.deepcopy(UNCERTAINTY_UNKNOWN),
    ),
)
write(
    "fixtures/assembly/quiet-day-es-ES.json",
    catalogue("quiet-day-es-ES", "fallback", [], locale="es-ES"),
)

# --------------------------------------------------------------------------
# JCS golden vectors
# --------------------------------------------------------------------------
def vector(name, description, obj, prefix="asm_"):
    canonical = jcs(obj)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return {
        "name": name,
        "description": description,
        "input": obj,
        "canonical": canonical,
        "full_digest": digest,
        "rendered_id": prefix + digest[:32],
    }


reordered = {k: IDENTITY_DAILY[k] for k in reversed(list(IDENTITY_DAILY.keys()))}

vectors = {
    "profile": "patternlike.assembly-id.v1",
    "canonicalization": "RFC 8785 JSON Canonicalization Scheme",
    "note": "canonical is the exact UTF-8 byte string; full_digest is SHA-256 of those bytes; rendered_id is the prefix plus the first 32 lowercase hex characters. An implementation that produces different bytes for any input here is not interoperable, even if its digest happens to round-trip.",
    "vectors": [
        vector(
            "nested-and-unicode",
            "Nested objects, a non-ASCII key, a non-ASCII value, an escaped control character, and an empty array.",
            {
                "z": {"b": [1, 2, 3], "a": {"deep": True}},
                "ä": "ünïcödé",
                "a": "line\nbreak\ttab",
                "empty": [],
                "nul": None,
            },
            prefix="vec_",
        ),
        vector(
            "number-forms",
            "Integers, negative integers, fractional numbers, and integral floats — all rendered by the ECMAScript number rule, so 3.0 canonicalizes as 3.",
            {"i": 42, "neg": -17, "frac": 0.42, "integral_float": 3.0, "zero": 0},
            prefix="vec_",
        ),
        vector(
            "assembly-identity-daily",
            "The canonical daily identity preimage.",
            IDENTITY_DAILY,
        ),
        vector(
            "assembly-identity-daily-reordered",
            "The same preimage with every top-level key in reverse insertion order. Canonical bytes and id must be identical to assembly-identity-daily: JCS sorts object keys, so source order cannot change identity.",
            reordered,
        ),
        vector(
            "assembly-identity-zero-facts",
            "A day with no eligible fact and no context. Empty arrays are preserved, not omitted.",
            IDENTITY_ZERO,
        ),
        vector(
            "assembly-identity-unknown-time",
            "Same date and chart, unknown effective accuracy with four suppressed feature classes. Must differ from assembly-identity-zero-facts: an uncertainty change that can alter output must change the id.",
            IDENTITY_UNKNOWN,
        ),
        vector(
            "cycle-identity-transit",
            "The cycle identity preimage. Pass timestamps are absent by design.",
            CYCLE_IDENTITY,
            prefix="cyc_",
        ),
    ],
}
write("fixtures/canonicalization/jcs-golden-vectors.json", vectors)

identity_without_rendered_id = copy.deepcopy(vectors)
identity_without_rendered_id["vectors"] = [
    copy.deepcopy(
        next(
            vector
            for vector in vectors["vectors"]
            if vector["name"] == "assembly-identity-daily"
        )
    )
]
del identity_without_rendered_id["vectors"][0]["rendered_id"]
write(
    "fixtures/canonicalization/invalid/identity-missing-rendered-id.json",
    identity_without_rendered_id,
)

print()
print("assembly_id daily       :", ASM_DAILY)
print("assembly_id zero-facts  :", ASM_ZERO)
print("assembly_id unknown-time:", ASM_UNKNOWN)
print("cycle_id                :", CYC_REAL)
assert ASM_ZERO != ASM_UNKNOWN, "uncertainty change must change the id"
v = {x["name"]: x for x in vectors["vectors"]}
assert (
    v["assembly-identity-daily"]["canonical"]
    == v["assembly-identity-daily-reordered"]["canonical"]
), "key reordering must not change canonical bytes"
print("invariants OK")
