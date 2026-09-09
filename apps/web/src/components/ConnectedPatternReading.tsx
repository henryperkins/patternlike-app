import { useMemo } from "react";
import type { PatternResponseV7, ReaderPatternTarget } from "@patternlike/shared";
import { createPortraitManifest } from "../lib/pattern-portrait.js";
import { AccountPortraitExplorer } from "./AccountPortraitExplorer.js";
import { CompleteChapter, CompleteReading } from "./portrait-explorer/ExplorerReader.js";

export function ConnectedPatternReading({ document, target, chartId, onUnauthorized }: {
  document: PatternResponseV7; target: ReaderPatternTarget; chartId: string; onUnauthorized: () => void;
}) {
  const manifest = useMemo(() => createPortraitManifest(document), [document]);
  const pattern = useMemo(() => ({ pattern_id: document.pattern_id, generated_at: document.generated_at, locale: document.locale, effective_accuracy: document.effective_accuracy }), [document]);
  return <section className="connected-pattern-reading">
    <h1 className="sr-only">Linked Pattern chapter</h1>
    <p className="reading-connection-boundary">Opened at chapter {target.chapter_index + 1} of this exact Pattern. The complete text and reading stations work without generated artwork.</p>
    <AccountPortraitExplorer chartId={chartId} document={document} pattern={pattern} canCreate={false} onUnauthorized={onUnauthorized} defaultOpen={false} initialChapterIndex={target.chapter_index}>
      <div className="explorer-complete"><CompleteChapter chapter={manifest.chapters[target.chapter_index]!} /></div>
      <details className="reading-connection-evidence"><summary>Read the complete Pattern</summary><CompleteReading manifest={manifest} embedded /></details>
    </AccountPortraitExplorer>
  </section>;
}
