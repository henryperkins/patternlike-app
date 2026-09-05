import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ZODIAC_SIGNS, type BirthTimeAccuracy, type ZodiacSignName } from "@patternlike/shared";
import { PatternPortrait } from "../components/PatternPortrait.js";
import { sunShapeProfiles } from "../lib/sun-sculpture.js";
import type { PortraitSource } from "../lib/pattern-portrait.js";
import { fictionalPattern } from "./pattern-portrait-fixture.js";
import { imageStudyBindings } from "./image-study.js";
import "../styles.css";
import "./pattern-portrait-preview.css";

const objectBindings = imageStudyBindings;

function PortraitPreview() {
  const [sunSign, setSunSign] = useState<ZodiacSignName | null>(null);
  const [accuracy, setAccuracy] = useState<BirthTimeAccuracy>("exact");
  const [status, setStatus] = useState<PortraitSource["status"]>("ready");
  const [replacement, setReplacement] = useState(false);
  const source = useMemo<PortraitSource>(() => {
    if (status !== "ready") return { status };
    return {
      status: "ready",
      sunSign,
      document: {
        ...fictionalPattern,
        pattern_id: replacement ? "pat_fictional_replacement" : fictionalPattern.pattern_id,
        effective_accuracy: accuracy,
        core_chapters: replacement ? fictionalPattern.core_chapters.slice(1) : fictionalPattern.core_chapters,
        uncertainty: accuracy === "unknown"
          ? { text: "Example uncertainty: without a birth time, houses and angles would be unavailable." }
          : accuracy === "approximate"
            ? { text: "Example uncertainty: an approximate birth time can limit time-sensitive chart details." }
            : null,
      },
    };
  }, [status, accuracy, replacement, sunSign]);

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
          <h1>Your Pattern,<br />given form.</h1>
          <div>
            <p>A different way to find your way through a reading. Take a closer look at one theme, then see it as part of the whole.</p>
            <p className="portrait-fictional-note">These chapters are fictional examples. Your Sun sign selection stays in this page.</p>
            <p className="portrait-fictional-note">Four generated objects become one unified sculpture. Add your Sun sign to influence its contours, proportions, and curvature.</p>
          </div>
        </div>
        <div className="portrait-sun-choice">
          <label htmlFor="portrait-sun-sign">Your Sun sign
            <select id="portrait-sun-sign" value={sunSign ?? ""} aria-describedby="portrait-sun-help" onChange={(event) => setSunSign(ZODIAC_SIGNS.find((sign) => sign === event.target.value) ?? null)}>
              <option value="">Choose your Sun sign</option>
              {ZODIAC_SIGNS.map((sign) => <option key={sign} value={sign}>{sunShapeProfiles[sign].label}</option>)}
            </select>
          </label>
          <p id="portrait-sun-help">Choose the sign from your birth chart. This preview uses the sign you provide; each shape is an artistic interpretation.</p>
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
