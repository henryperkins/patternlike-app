// Disposable local diagnosis using retained bytes and existing validators.
// Run from the repository root: npx tsx docs/reviews/artifacts/interpretation-quality/2026-09-09-retained-prose-diagnosis/replay.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validatePatternCandidate, wordCount } from "../../../../../packages/pattern-engine/src/index.ts";
import {
  findUnqualifiedProhibitedClaim, PATTERN_PUBLICATION_SAFETY_POLICY_VERSION,
} from "../../../../../apps/api/src/services/pattern-publication-safety.ts";

const retained = new URL("../2026-09-09-applicability-fix/", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, retained), "utf8"));
const before = JSON.parse(readFileSync(new URL("../2026-09-09-counter-expression-fix/candidate.json", retained), "utf8"));
const after = read("candidate.json");
const panel = read("chart-panel.json");
const chapterCounts = (chapter) => ({
  summary: wordCount(chapter.summary),
  sections: chapter.sections.map((part) => wordCount(part.text)),
  tensions: chapter.tensions.map((part) => wordCount(part.text)),
  resources: chapter.resources.map((part) => wordCount(part.text)),
  counter_expression: wordCount(chapter.counter_expression.text),
  title_excluded: wordCount(chapter.title),
});
const cases = [];
for (const caseId of ["exact-02", "unknown-02"]) {
  for (const variant of ["before", "after"]) {
    const name = `pinned-cli/samples/${caseId}-${variant}-writer.json`;
    const bytes = readFileSync(new URL(name, retained));
    const sample = JSON.parse(bytes.toString("utf8"));
    const writer = JSON.parse(sample.output);
    const selection = panel.cases.find((item) => item.case_id === caseId).variants[variant].selection;
    const ontology = (variant === "before" ? before : after).records;
    const validate = (candidate) => validatePatternCandidate(candidate, sample.request_document.plan, selection.packet, ontology);
    const prohibited = findUnqualifiedProhibitedClaim(writer);
    const result = {
      case_id: caseId, variant,
      retained_file: fileURLToPath(new URL(name, retained)),
      retained_file_sha256: createHash("sha256").update(bytes).digest("hex"),
      retained_output_sha256: createHash("sha256").update(sample.output).digest("hex"),
      retained_writer_status: sample.status,
      retained_writer_findings: sample.findings,
      candidate_validation: validate(writer),
      unqualified_prohibited_claim: prohibited ? { key: prohibited.key, text: prohibited.text } : null,
      chapter_04_counts: chapterCounts(writer.chapters[3]),
    };
    if (caseId === "exact-02" && variant === "before") {
      result.length_only_perturbations = [
        ["Keep this distinction visible.", 249],
        ["Keep this particular distinction visible.", 250],
      ].map(([append, words]) => {
        const clone = structuredClone(writer);
        clone.chapters[3].summary += ` ${append}`;
        return { words, appended_diagnostic_text: append, candidate_validation: validate(clone) };
      });
    }
    cases.push(result);
  }
}
console.log(JSON.stringify({
  scope: "Local candidate validation and generic prohibited-claim check only; no new semantic verdict, complete publication-safety evaluation, provider call, or publication.",
  publication_safety_policy_version: PATTERN_PUBLICATION_SAFETY_POLICY_VERSION,
  cases,
}, null, 2));
