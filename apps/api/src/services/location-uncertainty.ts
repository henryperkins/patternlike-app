import type {
  LocationQualifierCode,
  PlaceConfidence,
  PlaceQualifierCode,
  TimezoneConfidence,
  TimezoneQualifier,
} from "@patternlike/shared";

const CONFIDENCE_RANK: Record<TimezoneConfidence, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export interface LocationUncertaintyInput {
  geocodeConfidence: PlaceConfidence | null;
  timezoneConfidence: TimezoneConfidence;
  placeQualifierCodes: readonly PlaceQualifierCode[];
  timezoneQualifierCodes: readonly TimezoneQualifier["code"][];
}

export interface CombinedLocationUncertainty {
  confidence: TimezoneConfidence;
  qualifierCodes: LocationQualifierCode[];
}

export function combineLocationUncertainty(
  input: LocationUncertaintyInput,
): CombinedLocationUncertainty {
  const confidence = input.geocodeConfidence === null
    ? input.timezoneConfidence
    : CONFIDENCE_RANK[input.geocodeConfidence] <
        CONFIDENCE_RANK[input.timezoneConfidence]
      ? input.geocodeConfidence
      : input.timezoneConfidence;

  return {
    confidence,
    qualifierCodes: [...new Set<LocationQualifierCode>([
      ...input.placeQualifierCodes,
      ...input.timezoneQualifierCodes,
    ])],
  };
}
