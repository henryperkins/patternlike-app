let meta = #{
    name: "verify-m0-contracts",
    description: "Run automated M0 contract checks, parallel audit schemas/OpenAPI/D1/registry alignment, write a pass/fail report",
    when_to_use: "After changing contracts/m0, OpenAPI, D1 migrations, or before starting M1 implementation",
    phases: [
        #{ title: "Automated", detail: "validate_schemas.py + smoke_check.py" },
        #{ title: "Audit", detail: "four parallel read-only contract audits" },
        #{ title: "Report", detail: "synthesize markdown report" },
    ],
};

let auto_schema = #{
    "type": "object",
    "required": ["passed", "validate_exit", "smoke_exit", "summary", "details"],
    "properties": #{
        "passed": #{ "type": "boolean" },
        "validate_exit": #{ "type": "integer" },
        "smoke_exit": #{ "type": "integer" },
        "summary": #{ "type": "string" },
        "details": #{ "type": "string" },
    },
};

let findings_schema = #{
    "type": "object",
    "required": ["area", "findings", "notes"],
    "properties": #{
        "area": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["severity", "path", "issue"],
                "properties": #{
                    "severity": #{ "type": "string", "enum": ["blocker", "major", "minor", "note"] },
                    "path": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
        "notes": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["overall_pass", "title", "markdown", "blocker_count", "major_count"],
    "properties": #{
        "overall_pass": #{ "type": "boolean" },
        "title": #{ "type": "string" },
        "markdown": #{ "type": "string" },
        "blocker_count": #{ "type": "integer" },
        "major_count": #{ "type": "integer" },
    },
};

// Optional args.root defaults to repo-relative contracts path.
let root = "contracts/m0";
if args != () && args.root != () {
    root = args.root;
}

// --- Phase 1: automated validators (must use shell tools) ---
phase("Automated");
log("Running M0 automated validators under " + root);

let auto_prompt = "";
auto_prompt += "You are verifying Milestone 0 contracts in this repository.\n";
auto_prompt += "Working tree root is the current workspace (patternlike-app).\n";
auto_prompt += "1) Run: python contracts/m0/validate_schemas.py\n";
auto_prompt += "2) Run: python contracts/m0/smoke_check.py\n";
auto_prompt += "Capture exit codes and full stdout/stderr.\n";
auto_prompt += "Set passed=true only if BOTH commands exit 0.\n";
auto_prompt += "summary: one short paragraph. details: compact log of command output (truncate if huge).\n";
auto_prompt += "Do not skip running the commands. Do not invent pass/fail without tool output.\n";
auto_prompt += "Focus path hint: " + root + "\n";

let auto = agent(auto_prompt, #{
    label: "auto-validators",
    capability_mode: "execute",
    output_schema: auto_schema,
});

let auto_passed = false;
let auto_summary = "Automated validators did not complete successfully.";
let auto_details = "";
if auto != () && auto.success && auto.output != () {
    if auto.output.passed == true {
        auto_passed = true;
    }
    if auto.output.summary != () {
        auto_summary = auto.output.summary;
    }
    if auto.output.details != () {
        auto_details = auto.output.details;
    }
} else {
    log("Automated validator agent failed or returned unusable output; treat as fail-closed.");
}

// --- Phase 2: four parallel read-only audits (small fan-out) ---
phase("Audit");

let audit_jobs = [];

let p_schema = "";
p_schema += "Audit M0 JSON Schema consistency under contracts/m0/.\n";
p_schema += "Use read_file and grep on actual files — do not answer from memory.\n";
p_schema += "Check: all *.schema.json $id values; cross-file $ref to common.schema.json; schema_version 0.2.0;\n";
p_schema += "allowedUse enum coverage vs spec-bundle/*data_source_registry*.yaml allowed_use_vocabulary if present;\n";
p_schema += "NO-* rejection on ContextSignal/consent; chart const astronomy locks; fixture coverage in fixtures/.\n";
p_schema += "Return area=\"json-schemas\". At most 8 findings {severity, path, issue}.\n";
p_schema += "Empty findings only after you inspected the files. notes: brief coverage statement.\n";
audit_jobs.push(#{
    prompt: p_schema,
    label: "audit:schemas",
    capability_mode: "read-only",
    output_schema: findings_schema,
});

let p_api = "";
p_api += "Audit OpenAPI stub contracts/m0/openapi/openapi.yaml against product API surface.\n";
p_api += "Use read_file/grep. Compare routes to spec-bundle/*product_platform_spec*.md section API surface.\n";
p_api += "Required routes include: POST /v1/birth-profiles, GET /v1/chart, GET /v1/readings/today,\n";
p_api += "GET /v1/readings/{id}/evidence, GET /v1/pattern, GET /v1/timing, GET /v1/time-travel,\n";
p_api += "POST /v1/check-ins, POST /v1/readings/{id}/feedback, GET+PUT /v1/context-sources,\n";
p_api += "POST /v1/exports, DELETE /v1/account, POST /internal/content-releases.\n";
p_api += "Check Idempotency-Key on mutating methods and x-patternlike-contract pointers where claimed.\n";
p_api += "Return area=\"openapi\". At most 8 findings. Empty list only after reading the yaml and md.\n";
audit_jobs.push(#{
    prompt: p_api,
    label: "audit:openapi",
    capability_mode: "read-only",
    output_schema: findings_schema,
});

let p_d1 = "";
p_d1 += "Audit D1 migration db/d1/0001_m0_core.sql against contracts and entity list.\n";
p_d1 += "Use read_file. Entities expected: users, user_keys, identities, consents, birth_profiles,\n";
p_d1 += "chart_snapshots, natal_features, cycle_instances, context_signals, content_releases,\n";
p_d1 += "daily_readings, reading_sources, reading_feedback, device_tokens, connector_accounts, jobs, audit_events.\n";
p_d1 += "Check: encrypted payload columns, idempotency uniqueness for daily_readings and jobs,\n";
p_d1 += "NO-* guards, content_release_pointer, approver != author check if present.\n";
p_d1 += "Return area=\"d1\". At most 8 findings. Empty only after reading the SQL.\n";
audit_jobs.push(#{
    prompt: p_d1,
    label: "audit:d1",
    capability_mode: "read-only",
    output_schema: findings_schema,
});

let p_release = "";
p_release += "Audit content-release.schema.json and its valid fixture vs WordPress CPT requirements.\n";
p_release += "Use read_file on contracts/m0/content-release.schema.json and fixtures/valid/content-release.bundle.json\n";
p_release += "and the product spec (spec-bundle md/docx extract if available).\n";
p_release += "CPTs: astrology_pattern, cycle, phase, modifier, prompt, safety_rule, release signing.\n";
p_release += "Check dual-control notes, required safety_rules minItems, eligibility blocks, signature fields.\n";
p_release += "Return area=\"content-release\". At most 8 findings. Empty only after reading the files.\n";
audit_jobs.push(#{
    prompt: p_release,
    label: "audit:content-release",
    capability_mode: "read-only",
    output_schema: findings_schema,
});

let audit_results = parallel(audit_jobs);

let all_findings = [];
let i = 0;
for r in audit_results {
    if r == () || !r.success || r.output == () {
        log("Audit slot " + i.to_string() + " failed or empty — counting as unverified major finding.");
        all_findings.push(#{
            severity: "major",
            path: "workflow/audit",
            issue: "Audit agent slot " + i.to_string() + " failed or returned unusable output (fail-closed).",
            area: "audit-infra",
        });
    } else {
        let area = r.output.area;
        if area == () {
            area = "unknown";
        }
        if r.output.findings != () {
            for f in r.output.findings {
                let sev = f.severity;
                if sev == () {
                    sev = "minor";
                }
                let path = f.path;
                if path == () {
                    path = "";
                }
                let issue = f.issue;
                if issue == () {
                    issue = "";
                }
                all_findings.push(#{
                    severity: sev,
                    path: path,
                    issue: issue,
                    area: area,
                });
            }
        }
    }
    i += 1;
}

// --- Phase 3: synthesize report ---
phase("Report");

let findings_json = json_encode(all_findings);
let auto_json = json_encode(#{
    passed: auto_passed,
    summary: auto_summary,
    details: auto_details,
});

let synth_prompt = "";
synth_prompt += "Synthesize an M0 contract verification report in GitHub-flavored markdown.\n";
synth_prompt += "You may read contracts/m0/SCHEMA_MANIFEST.json for package context, but do not invent checks not in the inputs.\n";
synth_prompt += "Automated validator result (JSON):\n";
synth_prompt += auto_json;
synth_prompt += "\n\nAudit findings array (JSON):\n";
synth_prompt += findings_json;
synth_prompt += "\n\nRules:\n";
synth_prompt += "- overall_pass is true only if automated passed==true AND there are zero severity=blocker findings.\n";
synth_prompt += "- Count blocker_count and major_count accurately from the findings array.\n";
synth_prompt += "- markdown must include: title, automated section, findings table grouped by area, residual risks, recommended next actions.\n";
synth_prompt += "- If automated failed, overall_pass must be false.\n";
synth_prompt += "- title like 'M0 Contract Verification Report'.\n";

let synth = agent(synth_prompt, #{
    label: "synthesize-report",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let overall_pass = false;
let title = "M0 Contract Verification Report";
let markdown = "# M0 Contract Verification Report\n\nReport synthesis failed.\n";
let blocker_count = 0;
let major_count = 0;

// Fail-closed counts from our own tally if synthesis fails
for f in all_findings {
    if f.severity == "blocker" {
        blocker_count += 1;
    }
    if f.severity == "major" {
        major_count += 1;
    }
}
if auto_passed && blocker_count == 0 {
    overall_pass = true;
}

if synth != () && synth.success && synth.output != () {
    if synth.output.markdown != () && synth.output.markdown != "" {
        markdown = synth.output.markdown;
    }
    if synth.output.title != () {
        title = synth.output.title;
    }
    if synth.output.blocker_count != () {
        blocker_count = synth.output.blocker_count;
    }
    if synth.output.major_count != () {
        major_count = synth.output.major_count;
    }
    // Recompute overall_pass from authoritative automated + blocker rule
    overall_pass = false;
    if auto_passed && blocker_count == 0 {
        overall_pass = true;
    }
}

// Prepend machine status line so the report always reflects automated truth
let status_line = "**Automated validators:** FAIL";
if auto_passed {
    status_line = "**Automated validators:** PASS";
}
let gate_line = "**Overall gate:** FAIL";
if overall_pass {
    gate_line = "**Overall gate:** PASS";
}
markdown = "# " + title + "\n\n" + status_line + "\n\n" + gate_line + "\n\n" + markdown;

let report_path = write_scratch_file("m0-contract-verification.md", markdown);
log("Report written to " + report_path);
log("overall_pass=" + overall_pass.to_string() + " blockers=" + blocker_count.to_string() + " majors=" + major_count.to_string());

complete(#{
    path: report_path,
    overall_pass: overall_pass,
    auto_passed: auto_passed,
    blocker_count: blocker_count,
    major_count: major_count,
    finding_count: all_findings.len(),
    report: markdown,
});
