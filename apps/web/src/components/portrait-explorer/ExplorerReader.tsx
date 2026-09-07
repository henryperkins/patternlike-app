import { useId, useRef, type KeyboardEvent } from "react";
import type { PortraitChapter, PortraitManifest } from "../../lib/pattern-portrait.js";
import { chapterPassages } from "./content.js";
import { facets, type Facet } from "./types.js";

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
  activePassage: number;
  onFacet: (facet: Facet) => void;
  onPassage: (index: number) => void;
  passageRef: (index: number, element: HTMLParagraphElement | null) => void;
  graphicsAvailable: boolean;
  embedded?: boolean;
}
export function ExplorerReader({ chapters, chapterCount, facet, activePassage, onFacet, onPassage, passageRef, graphicsAvailable, embedded = false }: ReaderProps) {
  const panelId = useId();
  const compare = chapters.length === 2;
  const Heading = embedded ? "h3" : "h2";
  const ChapterHeading = embedded ? "h4" : "h3";
  return <>
    {!compare && <><Heading data-reader-heading tabIndex={-1}>{chapters[0].title}</Heading><p className="explorer-chapter-meta">Chapter {chapters[0].ordinal} of {chapterCount}</p><p className="explorer-summary">{chapters[0].summary}</p></>}
    {compare && <><Heading data-reader-heading tabIndex={-1}>Read them together</Heading><p className="explorer-summary">Explore the same perspective in each chapter.</p></>}
    <FacetTabs facet={facet} onChange={onFacet} panelId={panelId} />
    <div id={panelId} role="tabpanel" tabIndex={0} aria-labelledby={`${panelId}-${facet}`} className={compare ? "explorer-passages explorer-comparison" : "explorer-passages"}>
      {chapters.map((chapter, column) => <section key={chapter.id} aria-label={compare ? chapter.title : undefined}>
        {compare && <><ChapterHeading>{chapter.title}</ChapterHeading><p className="explorer-summary">{chapter.summary}</p></>}
        {chapterPassages(chapter, facet).map((text, index) => <div className="explorer-passage" data-active={column === 0 && index === activePassage} key={`${facet}-${index}`}>
          <p tabIndex={-1} ref={column === 0 ? (element) => passageRef(index, element) : undefined}>{text}</p>
          {!compare && <button className="explorer-text-button" disabled={!graphicsAvailable} aria-label={`Show passage ${index + 1} in portrait`} onClick={() => onPassage(index)}>Show in portrait <span aria-hidden="true">↗</span></button>}
        </div>)}
      </section>)}
    </div>
  </>;
}

export function CompleteReading({ manifest, embedded = false }: { manifest: PortraitManifest; embedded?: boolean }) {
  const Heading = embedded ? "h2" : "h1";
  const ChapterHeading = embedded ? "h3" : "h2";
  const FacetHeading = embedded ? "h4" : "h3";
  return <section className="explorer-complete" aria-label="Complete Pattern reading">
    <Heading>{manifest.chapters.length === 4 ? "Four chapters. One portrait." : "Your complete Pattern."}</Heading><p className="explorer-chapter-meta">Your Pattern · complete reading</p>
    {manifest.uncertainty && <p className="explorer-uncertainty">{manifest.uncertainty}</p>}
    {manifest.chapters.map((chapter) => <article key={chapter.id} data-reading-chapter={chapter.id} tabIndex={-1}><ChapterHeading>{chapter.title}</ChapterHeading><p className="explorer-chapter-meta">Chapter {chapter.ordinal}</p><p className="explorer-summary">{chapter.summary}</p>
      {facets.map(({ id, label }) => <section key={id}><FacetHeading>{label}</FacetHeading>{chapterPassages(chapter, id).map((text, index) => <p key={index}>{text}</p>)}</section>)}
    </article>)}
    {manifest.signatures.length > 0 && <section><ChapterHeading>Additional signatures</ChapterHeading>{manifest.signatures.map((signature, index) => <article key={index}><FacetHeading>{signature.title}</FacetHeading><p>{signature.text}</p></article>)}</section>}
    <p className="explorer-image-source">Source revision: {manifest.revision}</p>
  </section>;
}
