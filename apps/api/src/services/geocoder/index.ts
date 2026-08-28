import type { Env } from "../../env.js";
import { createGooglePlacesGeocoder } from "./google-places-geocoding-v4.js";
import type { GeocoderAdapter } from "./types.js";

export function createGeocoder(env: Pick<Env, "GOOGLE_MAPS_PLATFORM_API_KEY">): GeocoderAdapter {
  return createGooglePlacesGeocoder({
    apiKey: env.GOOGLE_MAPS_PLATFORM_API_KEY ?? "",
  });
}

export * from "./types.js";
