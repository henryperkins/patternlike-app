import type { PatternConsent } from "@patternlike/shared";
import { patternConsentCategoryLabel } from "../lib/reading-format.js";

/**
 * The named generation service.
 *
 * Separate from `consent.provider`, which is the processor of record and stays
 * `OpenAI` in D1 and on the wire. Naming only the processor left the reader
 * unable to tell which service actually writes their Pattern.
 */
export const PATTERN_CONSENT_GENERATION_SERVICE = "Codex";

export const PATTERN_CONSENT_PURPOSE =
  "Writing your Pattern, one per chart. This stays on until you withdraw it. If you correct your birth details, a Pattern for the corrected chart is written automatically, and the same kind of minimized content is sent again.";

export const PATTERN_CONSENT_PROCESSOR_NOTE =
  "Pattern/Like sends the minimized content listed above to Codex, operated by OpenAI, to plan, write, and check your Pattern. This takes multiple requests, with a limited number of retries. The same kind of content is sent again when a corrected chart is written automatically.";

export const PATTERN_CONSENT_TRAINING_NOTE =
  "This is not consent to train a model. Research and model training are separate permissions inside Pattern/Like; granting this does not grant or change either permission. Whether OpenAI uses content for training depends on the agreement and data-use settings for the account and workspace Pattern/Like uses. This grant does not control those settings.";

export const PATTERN_CONSENT_INPUT_NOTE =
  "Birth date, time, place, and coordinates are not sent as fields. The calculated positions that are sent can be used to reconstruct them. Pattern/Like does not describe the provider packet as anonymous.";

export const PATTERN_CONSENT_EXCLUSION_NOTE =
  "Daily check-ins, life events, journal entries, prior readings, and a biography are not sent. Pattern generation uses chart facts, uncertainty, your confirmed language, and the activated interpretation meanings only.";

export const PATTERN_CONSENT_RETENTION_NOTE =
  "For routine cleanup, Pattern/Like's encrypted request and response copies become eligible for deletion 30 days after each request finishes, fails, or is cancelled. Removal also waits until no active generation needs them and pending uploads are resolved, and failed cleanup is retried. OpenAI's retention follows the agreement and settings for the account and workspace Pattern/Like uses.";

export const PATTERN_CONSENT_REVOKE_NOTE =
  "You can withdraw this at any time in Privacy. Withdrawing stops unfinished and future Pattern generation, and it turns automatic artwork off. An already accepted Pattern stays readable until you delete it. Granting permission again does not turn automatic artwork back on.";

interface PatternConsentTermsProps {
  consent: PatternConsent;
  privacyLink?: boolean;
}

export function PatternConsentTerms({ consent, privacyLink }: PatternConsentTermsProps) {
  return (
    <div className="ai-consent-terms">
      <dl className="ai-consent-facts">
        <div>
          <dt>Processor</dt>
          <dd>{consent.provider}</dd>
        </div>
        <div>
          <dt>Generation service</dt>
          <dd>{PATTERN_CONSENT_GENERATION_SERVICE}</dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd>{PATTERN_CONSENT_PURPOSE}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd className="ai-consent-facts__code">v{consent.policy_version}</dd>
        </div>
      </dl>
      <ul className="ai-consent-categories" aria-label="What is sent">
        {consent.enabled_categories.map((category) => (
          <li key={category}>{patternConsentCategoryLabel(category)}</li>
        ))}
      </ul>
      <p className="ai-consent-note">{PATTERN_CONSENT_PROCESSOR_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_INPUT_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_EXCLUSION_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_TRAINING_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_RETENTION_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_REVOKE_NOTE}</p>
      <p className="ai-consent-note">
        A Pattern is written once for a chart. If the way Patterns are written
        changes, you can choose to replace this one.
      </p>
      <p className="ai-consent-note">
        Deleting your Pattern removes it from your account. Encrypted provider
        copies follow the 30-day deletion schedule, and saved artwork is erased
        with it.
      </p>
      {privacyLink ? (
        <p className="ai-consent-note">
          You can review or withdraw this later in <a href="#privacy">Privacy</a>.
        </p>
      ) : null}
    </div>
  );
}
