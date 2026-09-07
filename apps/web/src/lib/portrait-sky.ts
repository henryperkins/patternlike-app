import { ZODIAC_SIGNS, type ZodiacSignName } from "@patternlike/shared";
import type { ChartResponse } from "./api-client.js";

export type PortraitSkyBody = "sun" | "moon" | "ascendant";

export interface PortraitSkyPlacement {
  body: PortraitSkyBody;
  longitude: number;
  sign: ZodiacSignName;
  degree: number;
  house?: number;
  qualification?: string;
}

export interface PortraitSky {
  chartId: string;
  placements: readonly PortraitSkyPlacement[];
  uncertainty?: string;
  unavailable: Partial<Record<PortraitSkyBody, "missing" | "unknown_birth_time" | "suppressed">>;
}

type SkyChart = Pick<ChartResponse, "id" | "status" | "positions" | "angles" | "houses" | "uncertainty">;

/** A local display projection: chart identity stays out of labels and source-bound assets. */
export function createPortraitSky(chart: SkyChart, expectedChartId: string): PortraitSky | null {
  if (!expectedChartId.trim() || chart.id !== expectedChartId || chart.status !== "active") return null;
  const { accuracy, suppressed_features, qualified_features, user_facing_summary } = chart.uncertainty;
  const suppressed = new Set(suppressed_features.map(feature => feature.feature_class));
  const qualified = new Set(qualified_features.map(feature => feature.feature_id));
  const housesAvailable = accuracy !== "unknown" && !suppressed.has("houses") && chart.houses !== null;
  const placements: PortraitSkyPlacement[] = [];
  const unavailable: PortraitSky["unavailable"] = {};

  for (const body of ["sun", "moon", "ascendant"] as const) {
    if (body !== "sun" && accuracy === "unknown") {
      unavailable[body] = "unknown_birth_time";
      continue;
    }
    if ((body === "moon" && suppressed.has("moon_time_sensitive")) || (body === "ascendant" && suppressed.has("angles"))) {
      unavailable[body] = "suppressed";
      continue;
    }
    const position = body === "ascendant" ? undefined : chart.positions.find(position => position.body === body);
    const value = body === "ascendant" ? chart.angles?.ascendant_deg : position?.longitude_deg;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      unavailable[body] = "missing";
      continue;
    }
    const longitude = ((value % 360) + 360) % 360;
    const placement: PortraitSkyPlacement = {
      body, longitude, sign: ZODIAC_SIGNS[Math.floor(longitude / 30)]!, degree: longitude % 30,
    };
    const house = position?.house;
    if (housesAvailable && typeof house === "number" && Number.isInteger(house) && house >= 1 && house <= 12) placement.house = house;

    const qualifications: string[] = [];
    if (accuracy === "approximate") qualifications.push("Birth time is approximate.");
    if (body === "moon" && qualified.has("moon")) qualifications.push("The Moon placement has qualified confidence.");
    if (qualified.has("birth_instant")) qualifications.push("The civil-time conversion needs confirmation.");
    if (qualified.has("birthplace") && (body === "ascendant" || placement.house !== undefined)) qualifications.push("Birthplace resolution needs confirmation.");
    if (qualified.has("houses") && placement.house !== undefined && accuracy !== "approximate") qualifications.push("The house placement is qualified.");
    if (qualifications.length) placement.qualification = qualifications.join(" ");
    placements.push(placement);
  }

  return {
    chartId: chart.id, placements, unavailable,
    ...(user_facing_summary ? { uncertainty: user_facing_summary } : {}),
  };
}
