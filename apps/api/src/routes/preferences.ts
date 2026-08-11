import { Hono } from "hono";
import {
  M3_SCHEMA_VERSION,
  isValidIanaZone,
  requireIdempotencyKey,
} from "@patternlike/shared";
import { hasZone } from "../services/tzdb.js";
import type { Env } from "../env.js";
import type { AppVariables } from "../middleware/auth.js";
import {
  setContentLocale,
  setSchedulingTimezone,
  type PreferenceWriteSource,
} from "../db/preferences.js";

export const preferenceRoutes = new Hono<{
  Bindings: Env;
  Variables: AppVariables;
}>();

const WRITE_SOURCES: readonly PreferenceWriteSource[] = [
  "user_confirmed",
  "device_derived",
];

/** Matches the OpenAPI bound; also keeps a hostile tag out of Intl. */
const MAX_LOCALE_LENGTH = 35;

/**
 * The frozen M0 `localeTag` grammar. Checked in addition to `Intl`, not instead
 * of it: `Intl.getCanonicalLocales` accepts grandfathered tags like `i-klingon`
 * that this pattern rejects, and a stored locale that cannot be written into a
 * generation command is a value that fails at generation time rather than here.
 */
const LOCALE_TAG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/;

/**
 * BCP 47 well-formedness, not "is this locale supported".
 *
 * Support is resolved at read time by the engine's locale fallback chain
 * (exact supported locale, then the release's configured language fallback,
 * then its `locale_default`), so refusing an unsupported-but-valid tag here
 * would reject a legitimate preference the release simply cannot serve yet.
 */
function isWellFormedLocale(value: string): boolean {
  if (value.length < 2 || value.length > MAX_LOCALE_LENGTH) return false;
  if (!LOCALE_TAG_RE.test(value)) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function parseSource(value: unknown): PreferenceWriteSource | null {
  return WRITE_SOURCES.includes(value as PreferenceWriteSource)
    ? (value as PreferenceWriteSource)
    : null;
}

interface PreferenceBody {
  timezone?: unknown;
  locale?: unknown;
  source?: unknown;
}

preferenceRoutes.put("/v1/preferences/timezone", async (c) => {
  const requestId = c.get("requestId");
  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });

  const idem = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!idem) {
    return c.json(
      errorBody("missing_idempotency_key", "Idempotency-Key header required (8-256 chars)"),
      400,
    );
  }

  let body: PreferenceBody;
  try {
    body = (await c.req.json()) as PreferenceBody;
  } catch {
    return c.json(errorBody("invalid_json", "Request body must be valid JSON"), 400);
  }
  if (body === null || typeof body !== "object") {
    return c.json(errorBody("invalid_body", "Request body must be a JSON object"), 400);
  }

  const source = parseSource(body.source);
  if (!source) {
    return c.json(
      errorBody("invalid_body", "source must be user_confirmed or device_derived"),
      400,
    );
  }

  const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
  // A fixed UTC offset is never accepted as authority: it cannot answer what
  // the local date will be after the next DST transition, which is the only
  // question this value exists to answer.
  // Both gates, not one. isValidIanaZone asks the RUNTIME's ICU; every
  // scheduling consumer resolves the stored value through the package-pinned
  // tz database, and the two name sets are not equal — US/Pacific-New and
  // Canada/East-Saskatchewan pass ICU and are absent from the pinned table.
  // Storing one leaves a zone that throws on every later read: the write
  // commits, the cursor recompute throws, and from then on every scheduler
  // invocation aborts for every user. Refusing here is what keeps an
  // unresolvable zone from ever becoming durable.
  if (!timezone || !isValidIanaZone(timezone) || !hasZone(timezone)) {
    return c.json(
      errorBody(
        "invalid_timezone",
        `timezone must be an IANA zone id such as America/New_York (got ${timezone || "empty"})`,
      ),
      400,
    );
  }

  const result = await setSchedulingTimezone(
    c.env,
    c.get("userId"),
    timezone,
    source,
    idem,
  );
  if (!result.ok) {
    if (result.reason === "idempotency_conflict") {
      return c.json(
        errorBody(
          "idempotency_conflict",
          "Idempotency-Key was already used for a different time zone mutation",
        ),
        409,
      );
    }
    return c.json(
      result.reason === "preference_locked"
        ? errorBody(
            "preference_locked",
            "A device-derived update cannot overwrite a time zone you set yourself",
          )
        : errorBody(
            "preference_conflict",
            "The time zone changed concurrently; retry the request",
          ),
      409,
    );
  }

  return c.json(
    {
      schema_version: M3_SCHEMA_VERSION,
      timezone: result.value.timezone,
      source: result.value.timezoneSource,
      timezone_revision: result.value.timezoneRevision,
      // Never null on this path: the write that returns ok always stamps it,
      // and an unconfirmed default cannot be the result of a successful write.
      updated_at: result.value.timezoneUpdatedAt ?? new Date().toISOString(),
    },
    200,
  );
});

preferenceRoutes.put("/v1/preferences/locale", async (c) => {
  const requestId = c.get("requestId");
  const errorBody = (code: string, message: string) => ({
    error: { code, message, request_id: requestId },
  });

  const idem = requireIdempotencyKey(c.req.header("idempotency-key"));
  if (!idem) {
    return c.json(
      errorBody("missing_idempotency_key", "Idempotency-Key header required (8-256 chars)"),
      400,
    );
  }

  let body: PreferenceBody;
  try {
    body = (await c.req.json()) as PreferenceBody;
  } catch {
    return c.json(errorBody("invalid_json", "Request body must be valid JSON"), 400);
  }
  if (body === null || typeof body !== "object") {
    return c.json(errorBody("invalid_body", "Request body must be a JSON object"), 400);
  }

  const source = parseSource(body.source);
  if (!source) {
    return c.json(
      errorBody("invalid_body", "source must be user_confirmed or device_derived"),
      400,
    );
  }

  const locale = typeof body.locale === "string" ? body.locale.trim() : "";
  if (!locale || !isWellFormedLocale(locale)) {
    return c.json(
      errorBody(
        "invalid_locale",
        `locale must be a well-formed BCP 47 tag such as en-US (got ${locale || "empty"})`,
      ),
      400,
    );
  }

  const result = await setContentLocale(
    c.env,
    c.get("userId"),
    locale,
    source,
    idem,
  );
  if (!result.ok) {
    if (result.reason === "idempotency_conflict") {
      return c.json(
        errorBody(
          "idempotency_conflict",
          "Idempotency-Key was already used for a different locale mutation",
        ),
        409,
      );
    }
    return c.json(
      result.reason === "preference_locked"
        ? errorBody(
            "preference_locked",
            "A device-derived update cannot overwrite a locale you set yourself",
          )
        : errorBody(
            "preference_conflict",
            "The locale changed concurrently; retry the request",
          ),
      409,
    );
  }

  return c.json(
    {
      schema_version: M3_SCHEMA_VERSION,
      locale: result.value.locale,
      source: result.value.localeSource,
      updated_at: result.value.localeUpdatedAt ?? new Date().toISOString(),
    },
    200,
  );
});
