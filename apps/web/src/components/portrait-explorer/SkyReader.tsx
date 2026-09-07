import type { ZodiacSignName } from "@patternlike/shared";
import type { PortraitSky, PortraitSkyBody, PortraitSkyPlacement } from "../../lib/portrait-sky.js";

export const skyBodyLabels: Record<PortraitSkyBody, string> = { sun: "Sun", moon: "Moon", ascendant: "Rising" };
export const signLabel = (sign: ZodiacSignName) => sign.charAt(0).toUpperCase() + sign.slice(1);
const bodyOrder: PortraitSkyBody[] = ["sun", "moon", "ascendant"];

function BodyIcon({ body }: { body: PortraitSkyBody }) {
  return <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body === "sun" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
      : body === "moon" ? <path d="M18.7 17.3A8.5 8.5 0 0 1 8 4a8.5 8.5 0 1 0 10.7 13.3Z" />
        : <><path d="M3 18h18M12 15V3m-4 4 4-4 4 4" /><path d="M6 18a6 6 0 0 1 12 0" /></>}
  </svg>;
}

function availablePlacements(sky: PortraitSky | null, sunSign: ZodiacSignName | null) {
  if (sky) return sky.placements;
  return sunSign ? [{ body: "sun" as const, sign: sunSign }] : [];
}

export function SkyPlacements({ sky, sunSign, selected, onSelect }: {
  sky: PortraitSky | null; sunSign: ZodiacSignName | null; selected?: PortraitSkyBody | null;
  onSelect: (body: PortraitSkyBody) => void;
}) {
  const placements = availablePlacements(sky, sunSign);
  return <div className="sky-placements" role="group" aria-label="Birth-chart placements">{bodyOrder.map(body => {
    const placement = placements.find(item => item.body === body);
    return placement ? <button key={body} type="button" aria-label={`${skyBodyLabels[body]} in ${signLabel(placement.sign)}`} aria-pressed={selected === body} onClick={() => onSelect(body)}>
      <BodyIcon body={body} /><span><span>{skyBodyLabels[body]}</span><strong>{signLabel(placement.sign)}</strong></span>
    </button> : <div className="sky-placement-unavailable" key={body}><BodyIcon body={body} /><span><span>{skyBodyLabels[body]}</span><small>{sky?.unavailable[body] === "suppressed" ? "Unavailable in this chart" : sky?.unavailable[body] === "unknown_birth_time" ? "Birth time unknown" : "Not available"}</small></span></div>;
  })}</div>;
}

function degreeLabel(placement: PortraitSkyPlacement) {
  const minutes = Math.floor(placement.degree * 60 + 1e-7);
  return `${Math.floor(minutes / 60)}° ${String(minutes % 60).padStart(2, "0")}′ ${signLabel(placement.sign)}`;
}

export function SkyReader({ sky, sunSign, selected, onPattern, embedded }: {
  sky: PortraitSky | null; sunSign: ZodiacSignName | null; selected: PortraitSkyBody | null;
  onPattern: () => void; embedded: boolean;
}) {
  const placement = sky?.placements.find(item => item.body === selected);
  const savedSun = !sky && selected === "sun" ? sunSign : null;
  const Heading = embedded ? "h3" : "h2";
  return <div className="sky-reader">
    <Heading data-reader-heading tabIndex={-1}>{placement ? `${skyBodyLabels[placement.body]} in ${signLabel(placement.sign)}` : savedSun ? `Sun in ${signLabel(savedSun)}` : "The sky behind your Pattern."}</Heading>
    {placement && <p className="sky-position">{degreeLabel(placement)}</p>}
    {placement ? <>
      <p>{placement.body === "ascendant" ? "Your rising sign marks the eastern horizon in your birth chart." : `This is the ${skyBodyLabels[placement.body]}’s position in your birth chart.`} The ring places it within the twelve signs of the zodiac.</p>
      {placement.house && <p className="sky-fact">House {placement.house}</p>}
      {placement.qualification && <p className="explorer-uncertainty">{placement.qualification}</p>}
    </> : savedSun ? <p>The saved portrait includes your Sun sign. Its exact position is not available in this view.</p>
      : <p>Your birth-chart placements are not available in this view. The twelve-sign ring remains available to explore.</p>}
    {sky?.uncertainty && <p className="explorer-uncertainty">{sky.uncertainty}</p>}
    <div className="sky-reading-bridge"><h4>From your sky to your Pattern</h4><p>Your four chapters bring the chart into a personal reading. Return to a chapter to explore its tensions, resources, and another expression.</p>
      <button type="button" className="explorer-primary" onClick={onPattern}>Explore your Pattern</button>
      {embedded && <a className="sky-today-link" href="#today">Read today’s horoscope</a>}
    </div>
    <p className="sky-map-note">A view of your birth chart. When shown, marker sizes and spacing do not represent planetary size or distance.</p>
  </div>;
}
