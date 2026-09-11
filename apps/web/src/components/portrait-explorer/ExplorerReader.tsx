import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { PortraitChapter, PortraitManifest } from "../../lib/pattern-portrait.js";
import { chapterPassages } from "./content.js";
import { facets, type Facet } from "./types.js";

export function ReaderFooter({ readerRef, readerId, contentKey, reducedMotion, children }: {
  readerRef: RefObject<HTMLElement | null>;
  readerId: string;
  contentKey: string;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const [continuation, setContinuation] = useState<"none" | "more" | "end">("none");
  const continuationButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    const measure = () => {
      const scrollable = /^(auto|scroll)$/.test(getComputedStyle(reader).overflowY)
        && reader.clientHeight > 0 && reader.scrollHeight > reader.clientHeight + 2;
      if (!scrollable && document.activeElement === continuationButton.current) reader.focus({ preventScroll: true });
      setContinuation(!scrollable ? "none" : reader.scrollTop + reader.clientHeight < reader.scrollHeight - 2 ? "more" : "end");
    };
    measure();
    reader.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(reader);
    if (reader.firstElementChild) observer?.observe(reader.firstElementChild);
    return () => {
      observer?.disconnect();
      reader.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [readerRef, contentKey]);
  const continueReading = () => {
    const reader = readerRef.current;
    if (!reader) return;
    const behavior = reducedMotion ? "instant" : "smooth";
    if (continuation === "end") reader.scrollTo({ top: 0, behavior });
    else reader.scrollBy({ top: reader.clientHeight * .8, behavior });
  };
  return <div className="explorer-reader-footer" role="group" aria-label="Chapter actions">
    <div className="explorer-reading-continuation" aria-hidden={continuation === "none"} style={{ visibility: continuation === "none" ? "hidden" : "visible" }}>
      <span className="explorer-continuation-status" role="status"><span aria-hidden={continuation !== "more"}>More to read</span><span aria-hidden={continuation !== "end"}>End of this reading</span></span>
      <button ref={continuationButton} className="explorer-text-button" tabIndex={continuation === "none" ? -1 : 0} aria-controls={readerId} onClick={continueReading}><span aria-hidden={continuation !== "more"}>Continue reading <span aria-hidden="true">↓</span></span><span aria-hidden={continuation !== "end"}>Back to start <span aria-hidden="true">↑</span></span></button>
    </div>
    {children}
  </div>;
}

export function FacetTabs({ facet, onChange, panelId }: { facet: Facet; onChange: (facet: Facet) => void; panelId: string }) {
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const index = facets.findIndex((item) => item.id === facet);
    const next = event.key === "Home" ? 0 : event.key === "End" ? facets.length - 1
      : event.key === "ArrowRight" ? (index + 1) % facets.length : event.key === "ArrowLeft" ? (index + facets.length - 1) % facets.length : -1;
    if (next < 0) return;
    event.preventDefault(); onChange(facets[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return <div className="explorer-facets" role="tablist" aria-label="Chapter perspectives" ref={list} onKeyDown={onKeyDown}>
    {facets.map((item) => <button key={item.id} id={`${panelId}-${item.id}`} role="tab" aria-selected={facet === item.id}
      aria-controls={panelId} tabIndex={facet === item.id ? 0 : -1} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>;
}

interface ReaderProps {
  chapters: PortraitChapter[];
  chapterCount: number;
  facet: Facet;
  activePassages: Readonly<Record<string, number>>;
  onFacet: (facet: Facet) => void;
  onPassage: (chapterId: string, index: number) => void;
  onInspect: (chapterId: string) => void;
  passageRef: (chapterId: string, index: number, element: HTMLParagraphElement | null) => void;
  graphicsAvailable: boolean;
  embedded?: boolean;
}
function ChapterArtwork({ chapter, onInspect }: { chapter: PortraitChapter; onInspect?: (chapterId: string) => void }) {
  if (!chapter.object) return null;
  return <div className="explorer-artwork">
    <details><summary>About this artwork</summary><p><strong>{chapter.object.label}</strong></p><p>{chapter.object.rationale}</p></details>
    {onInspect && <button className="explorer-text-button" onClick={() => onInspect(chapter.id)}>Inspect original image for {chapter.title} <span aria-hidden="true">↗</span></button>}
  </div>;
}

export function ExplorerReader({ chapters, chapterCount, facet, activePassages, onFacet, onPassage, onInspect, passageRef, graphicsAvailable, embedded = false }: ReaderProps) {
  const panelId = useId();
  const compare = chapters.length === 2;
  const Heading = embedded ? "h3" : "h2";
  const ChapterHeading = embedded ? "h4" : "h3";
  return <>
    {!compare && <><Heading data-reader-heading tabIndex={-1}>{chapters[0].title}</Heading><p className="explorer-chapter-meta">Chapter {chapters[0].ordinal} of {chapterCount}</p><p className="explorer-summary">{chapters[0].summary}</p><ChapterArtwork key={chapters[0].id} chapter={chapters[0]} /></>}
    {compare && <><Heading data-reader-heading tabIndex={-1}>Read them together</Heading><p className="explorer-summary">Explore the same perspective in each chapter.</p></>}
    <FacetTabs facet={facet} onChange={onFacet} panelId={panelId} />
    <div id={panelId} role="tabpanel" tabIndex={0} aria-labelledby={`${panelId}-${facet}`} className={compare ? "explorer-passages explorer-comparison" : "explorer-passages"}>
      {chapters.map((chapter) => <section key={chapter.id} aria-label={compare ? chapter.title : undefined}>
        {compare && <><ChapterHeading>{chapter.title}</ChapterHeading><p className="explorer-summary">{chapter.summary}</p><ChapterArtwork chapter={chapter} onInspect={onInspect} /></>}
        {chapterPassages(chapter, facet).map((text, index) => <div className="explorer-passage" data-active={index === (activePassages[chapter.id] ?? 0)} key={`${facet}-${index}`}>
          <div className="explorer-passage-caption"><span>Passage {index + 1}</span>{" "}<span className="explorer-passage-selection" aria-hidden={!graphicsAvailable || index !== (activePassages[chapter.id] ?? 0)} style={{ visibility: graphicsAvailable && index === (activePassages[chapter.id] ?? 0) ? "visible" : "hidden" }}>Selected in portrait</span></div>
          <p tabIndex={-1} ref={(element) => passageRef(chapter.id, index, element)}>{text}</p>
          <button className="explorer-text-button" disabled={!graphicsAvailable} aria-description={`${chapter.title} · ${facets.find(item => item.id === facet)!.label}`} onClick={() => onPassage(chapter.id, index)}>Show passage {index + 1} in portrait <span aria-hidden="true">↗</span></button>
        </div>)}
      </section>)}
    </div>
  </>;
}

export function CompleteChapter({ chapter, embedded = false }: { chapter: PortraitChapter; embedded?: boolean }) {
  const ChapterHeading = embedded ? "h3" : "h2";
  const FacetHeading = embedded ? "h4" : "h3";
  return <article data-reading-chapter={chapter.id} tabIndex={-1}><ChapterHeading>{chapter.title}</ChapterHeading><p className="explorer-chapter-meta">Chapter {chapter.ordinal}</p><p className="explorer-summary">{chapter.summary}</p>
    {facets.map(({ id, label }) => <section key={id}><FacetHeading>{label}</FacetHeading>{chapterPassages(chapter, id).map((text, index) => <p key={index}>{text}</p>)}</section>)}
  </article>;
}

export function CompleteReading({ manifest, embedded = false }: { manifest: PortraitManifest; embedded?: boolean }) {
  const Heading = embedded ? "h2" : "h1";
  const ChapterHeading = embedded ? "h3" : "h2";
  const FacetHeading = embedded ? "h4" : "h3";
  return <section className="explorer-complete" aria-label="Complete Pattern reading">
    <Heading>{manifest.chapters.length === 4 ? "Four chapters. One portrait." : "Your complete Pattern."}</Heading><p className="explorer-chapter-meta">Your Pattern · complete reading</p>
    {manifest.uncertainty && <p className="explorer-uncertainty">{manifest.uncertainty}</p>}
    {manifest.chapters.map((chapter) => <CompleteChapter key={chapter.id} chapter={chapter} embedded={embedded} />)}
    {manifest.signatures.length > 0 && <section><ChapterHeading>Additional signatures</ChapterHeading>{manifest.signatures.map((signature, index) => <article key={index}><FacetHeading>{signature.title}</FacetHeading><p>{signature.text}</p></article>)}</section>}
    <p className="explorer-image-source">Source revision: {manifest.revision}</p>
  </section>;
}
