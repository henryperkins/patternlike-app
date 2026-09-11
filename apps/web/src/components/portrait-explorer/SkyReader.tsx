import type { ZodiacSignName } from "@patternlike/shared";
import type { PortraitSky, PortraitSkyBody, PortraitSkyPlacement } from "../../lib/portrait-sky.js";

export const skyBodyLabels: Record<PortraitSkyBody, string> = { sun: "Sun", moon: "Moon", ascendant: "Rising" };
export const signLabel = (sign: ZodiacSignName) => sign.charAt(0).toUpperCase() + sign.slice(1);
const bodyOrder: PortraitSkyBody[] = ["sun", "moon", "ascendant"];

export function BodyIcon({ body }: { body: PortraitSkyBody }) {
  return <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body === "sun" ? <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" fill="currentColor" /></>
      : body === "moon" ? <circle cx="12" cy="12" r="7" fill="currentColor" fillOpacity=".35" />
        : <><path d="m12 2 10 10-10 10L2 12Z" fill="currentColor" fillOpacity=".2" /><path d="m2 12 10-3 10 3m-10-3v13" /></>}

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

export function SkyReader({ sky, sunSign, selected, onPattern, embedded, graphicsAvailable = true }: {
  sky: PortraitSky | null; sunSign: ZodiacSignName | null; selected: PortraitSkyBody | null;
  onPattern: () => void; embedded: boolean; graphicsAvailable?: boolean;
}) {
  const placement = sky?.placements.find(item => item.body === selected);
  const savedSun = !sky && selected === "sun" ? sunSign : null;
  const Heading = embedded ? "h3" : "h2";
  const Subheading = embedded ? "h4" : "h3";
  return <div className="sky-reader">
    <Heading data-reader-heading tabIndex={-1}>{placement ? `${skyBodyLabels[placement.body]} in ${signLabel(placement.sign)}` : savedSun ? `Sun in ${signLabel(savedSun)}` : "The sky behind your Pattern."}</Heading>
    {placement && <p className="sky-position">{degreeLabel(placement)}</p>}
    {placement ? <>
      <p>{placement.body === "ascendant" ? "Your rising sign marks the eastern horizon in your birth chart." : `This is the ${skyBodyLabels[placement.body]}’s position in your birth chart.`} The ring places it within the twelve signs of the zodiac.</p>
      {placement.house && <p className="sky-fact">House {placement.house}</p>}
      {placement.qualification && <p className="explorer-uncertainty">{placement.qualification}</p>}
    </> : savedSun ? <p>The saved portrait includes your Sun sign. Its exact position is not available in this view.</p>
      : <p>Your birth-chart placements are not available in this view. {graphicsAvailable ? "The twelve-sign ring remains available to explore." : "Your saved Pattern remains available to read."}</p>}
    {sky?.uncertainty && <p className="explorer-uncertainty">{sky.uncertainty}</p>}
    <div className="sky-reading-bridge"><Subheading>From your sky to your Pattern</Subheading><p>Your chapters bring the chart into a personal reading. Return to a chapter to explore its tensions, resources, and another expression.</p>
      <button type="button" className="explorer-primary" onClick={onPattern}>Explore your Pattern</button>
      {embedded && <a className="sky-today-link" href="#today">Open today’s reading</a>}
    </div>
    <p className="sky-map-note">A view of your birth chart. When shown, marker sizes and spacing do not represent planetary size or distance.</p>
  </div>;
}
