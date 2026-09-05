import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ZODIAC_SIGNS, type BirthTimeAccuracy, type ZodiacSignName } from "@patternlike/shared";
import { PatternPortrait } from "../components/PatternPortrait.js";
import { sunShapeProfiles } from "../lib/sun-sculpture.js";
import type { PortraitSource } from "../lib/pattern-portrait.js";
import { fictionalPattern } from "./pattern-portrait-fixture.js";
import { imageStudyBindings } from "./image-study.js";
import { nativeImageBindings, nativePattern } from "./native-image-study.js";
import "../styles.css";
import "./pattern-portrait-preview.css";

function PortraitPreview() {
  const [example, setExample] = useState("direction");
  const [sunSign, setSunSign] = useState<ZodiacSignName | null>(null);
  const [accuracy, setAccuracy] = useState<BirthTimeAccuracy>("exact");
  const [status, setStatus] = useState<PortraitSource["status"]>("ready");
  const [replacement, setReplacement] = useState(false);
  const pattern = example === "direction" ? nativePattern : fictionalPattern;
  const objectBindings = example === "direction" ? nativeImageBindings : imageStudyBindings;
  const source = useMemo<PortraitSource>(() => {
    if (status !== "ready") return { status };
    return {
      status: "ready",
      sunSign,
      document: {
        ...pattern,
        pattern_id: replacement ? "pat_fictional_replacement" : pattern.pattern_id,
        effective_accuracy: accuracy,
        core_chapters: replacement ? pattern.core_chapters.slice(1) : pattern.core_chapters,
        uncertainty: accuracy === "unknown"
          ? { text: "Example uncertainty: without a birth time, houses and angles would be unavailable." }
          : accuracy === "approximate"
            ? { text: "Example uncertainty: an approximate birth time can limit time-sensitive chart details." }
            : null,
      },
    };
  }, [status, accuracy, replacement, sunSign, pattern]);

  return (
    <div className="portrait-preview">
      <a className="skip-link" href="#portrait-main">Skip to the portrait</a>
      <header className="portrait-preview-header">
        <a href="/pattern-portrait.html" aria-label="Pattern/Like portrait preview" className="portrait-preview-wordmark">
          <img src="/mark.svg" width="30" height="30" alt="" />
          <span>Pattern<span className="portrait-wordmark-light">/Like</span></span>
        </a>
        <span className="portrait-preview-label">Fictional preview</span>
      </header>
      <main id="portrait-main">
        <div className="portrait-preview-intro">
          <h1>Your Pattern,<br />in constellation.</h1>
          <div>
            <p>Four chapter images, one constellation.</p>
            <p className="portrait-fictional-note">Choose a fictional reading to compare. Your choices stay on this page.</p>
          </div>
        </div>
        <div className="portrait-sun-choice">
          <label htmlFor="portrait-example">Reading
            <select id="portrait-example" value={example} onChange={(event) => { setExample(event.target.value); setReplacement(false); setStatus("ready"); }}>
              <option value="direction">Direction &amp; care</option>
              <option value="space">Space &amp; change</option>
            </select>
          </label>
          <label htmlFor="portrait-sun-sign">Your Sun sign
            <select id="portrait-sun-sign" value={sunSign ?? ""} aria-describedby="portrait-sun-help" onChange={(event) => setSunSign(ZODIAC_SIGNS.find((sign) => sign === event.target.value) ?? null)}>
              <option value="">Choose a sign</option>
              {ZODIAC_SIGNS.map((sign) => <option key={sign} value={sign}>{sunShapeProfiles[sign].label}</option>)}
            </select>
          </label>
          <p id="portrait-sun-help">Optional. Your sign guides an artistic arrangement.</p>
        </div>
        <PatternPortrait source={source} objectBindings={objectBindings} />
        <details className="portrait-preview-scenarios">
          <summary>Preview scenarios</summary>
          <p>Try the same reading with different data states. These controls belong to this fictional preview.</p>
          <div className="portrait-scenario-fields">
            <label>Example birth-time accuracy
              <select value={accuracy} onChange={(event) => setAccuracy(event.target.value as BirthTimeAccuracy)}>
                <option value="exact">Exact</option><option value="approximate">Approximate</option><option value="unknown">Unknown</option>
              </select>
            </label>
            <label>Document state
              <select value={status} onChange={(event) => setStatus(event.target.value as PortraitSource["status"])}>
                <option value="ready">Available</option><option value="loading">Loading</option><option value="unavailable">Removed</option>
              </select>
            </label>
            <button type="button" onClick={() => { setReplacement((previous) => !previous); setStatus("ready"); }}>
              {replacement ? "Restore four-chapter sample" : "Replace with three-chapter sample"}
            </button>
          </div>
        </details>
      </main>
      <footer className="portrait-preview-footer"><span>A spatial reading study</span><span>Pattern/Like · September 2026</span></footer>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Preview root missing");
createRoot(root).render(<StrictMode><PortraitPreview /></StrictMode>);
