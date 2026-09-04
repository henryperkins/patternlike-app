import type { Env } from "../../env.js";
import { createGeoapifyGeocoder } from "./geoapify.js";
import type { GeocoderAdapter } from "./types.js";

export function isGeocoderAvailable(env: Pick<Env, "GEOCODER_ROLLOUT" | "GEOAPIFY_API_KEY">): boolean {
  return env.GEOCODER_ROLLOUT?.trim() === "enabled" && !!env.GEOAPIFY_API_KEY?.trim();
}

export function createGeocoder(env: Pick<Env, "GEOAPIFY_API_KEY">): GeocoderAdapter {
  return createGeoapifyGeocoder({
    apiKey: env.GEOAPIFY_API_KEY ?? "",
  });
}

export * from "./types.js";
