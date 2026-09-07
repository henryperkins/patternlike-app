import type { ObservatoryExperience } from "./types.js";

export function ObservatoryControls({ experience, onChange, available, chapterId, onOperate, skyView = false }: {
  experience: ObservatoryExperience;
  onChange: (update: Partial<ObservatoryExperience>) => void;
  available: boolean;
  chapterId?: string;
  onOperate: () => void;
  skyView?: boolean;
}) {
  return <div className="observatory-controls">
    <div className="observatory-environment" role="group" aria-label="Courtyard atmosphere">
      <div className="observatory-light" role="group" aria-label="Lighting">
        {(["day", "dusk"] as const).map(light => <button key={light} disabled={!available} aria-pressed={experience.lighting === light}
          onClick={() => onChange({ lighting: light })}>{light === "day" ? "Daylight" : "Dusk"}</button>)}
      </div>
      <button disabled={!available} aria-pressed={!experience.roofOpen} onClick={() => onChange({ roofOpen: !experience.roofOpen })}>
        {experience.roofOpen ? "Show roof" : "Cut away roof"}
      </button>
    </div>
    {chapterId && <div className="observatory-workbench" role="group" aria-label="Chapter display">
      <button disabled={!available} aria-pressed={experience.inspect} onClick={() => onChange({ inspect: !experience.inspect })}>
        {experience.inspect ? "Step back" : "Look closer"}
      </button>
      <button disabled={!available} onClick={() => onChange({ turns: { ...experience.turns, [chapterId]: (experience.turns[chapterId] ?? 0) + 1 } })}>Turn chapter object</button>
      <button disabled={!available} aria-pressed={Boolean(experience.openDesks[chapterId])} onClick={onOperate}>
        {experience.openDesks[chapterId] ? "Close reading desk" : "Open reading desk"}
      </button>
    </div>}
    <p className="observatory-hint" aria-live="polite">{!available ? "Your chapter reading remains available while the scene is paused." : skyView ? "Explore the twelve-sign ring and any available placements." : chapterId
      ? experience.openDesks[chapterId] ? "The reading desk is open. Explore each perspective in the chapter reading." : "Turn the object to inspect every side, or open its reading desk."
      : "A court, four chapter spaces. Choose a chapter to approach its display."}</p>
  </div>;
}
