/**
 * What this device believes about itself.
 *
 * Automatic writes mark both values `device_derived`; the preference routes
 * keep them subordinate to `user_confirmed`, so a device suggestion cannot
 * overwrite a choice the reader made.
 */
export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function systemLocale(): string {
  return navigator.language || "en-US";
}

/**
 * Every zone this browser knows, for the datalist behind the zone input.
 *
 * `Intl.supportedValuesOf` is unavailable on older Safari, and a hand-maintained
 * list would be wrong the first time tzdata moved. Absent, the input is simply a
 * plain text field.
 */
export function knownTimezones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported !== "function") return [];
  try {
    return supported("timeZone");
  } catch {
    return [];
  }
}
