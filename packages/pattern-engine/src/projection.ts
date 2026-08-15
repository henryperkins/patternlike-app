import type {
  PatternDocumentInternal,
  PatternPublicChapter,
  PatternResponseV7,
  PatternWriterOutput,
} from "@patternlike/shared";

function publicUnit(text: string): { text: string } {
  return { text };
}

export function stripPrivateEvidence(output: PatternWriterOutput): {
  core_chapters: PatternPublicChapter[];
  additional_signatures: Array<{ title: string; text: string }>;
  uncertainty: { text: string } | null;
} {
  return {
    core_chapters: output.chapters.map((chapter) => ({
      title: chapter.title,
      summary: chapter.summary,
      sections: chapter.sections.map((section) => ({ text: section.text })),
      tensions: chapter.tensions.map((unit) => publicUnit(unit.text)),
      resources: chapter.resources.map((unit) => publicUnit(unit.text)),
      counter_expression: publicUnit(chapter.counter_expression.text),
    })),
    additional_signatures: output.additional_signatures.map((signature) => ({
      title: signature.title,
      text: signature.text,
    })),
    uncertainty: output.uncertainty_note ? publicUnit(output.uncertainty_note.text) : null,
  };
}

export function projectPublicPattern(
  document: PatternDocumentInternal,
  generatedAt: string,
): PatternResponseV7 {
  const stripped = stripPrivateEvidence(document.artifact);
  return {
    schema_version: "0.7.0",
    pattern_id: document.pattern_id,
    generated_at: generatedAt,
    locale: document.locale,
    effective_accuracy: document.effective_accuracy,
    provenance: {
      assembly_mode: "constrained_model",
      provider: document.compact_provenance.provider,
      model_family: document.compact_provenance.model_family,
      raw_birth_details_sent: false,
    },
    core_chapters: stripped.core_chapters,
    additional_signatures: stripped.additional_signatures,
    uncertainty: stripped.uncertainty,
  };
}
