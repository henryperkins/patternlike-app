import type { PatternConsent } from "@patternlike/shared";
import { patternConsentCategoryLabel } from "../lib/reading-format.js";

export const PATTERN_CONSENT_PURPOSE =
  "Writing one Pattern for this chart, and nothing else.";

export const PATTERN_CONSENT_TRAINING_NOTE =
  "This is not consent to train a model. Research and model training are separate permissions, and granting this leaves both of them off.";

export const PATTERN_CONSENT_INPUT_NOTE =
  "Birth date, time, place, and coordinates are not sent as fields. Calculated natal features are still sensitive derived data and may support inferences about birth timing. Pattern/Like does not describe the provider packet as anonymous.";

export const PATTERN_CONSENT_EXCLUSION_NOTE =
  "Daily check-ins, life events, journal entries, prior readings, and a biography are not sent. Pattern generation uses chart facts, uncertainty, your confirmed language, and the activated interpretation meanings only.";

export const PATTERN_CONSENT_RETENTION_NOTE =
  "Requests are sent with provider-side storage turned off. That is not zero retention: OpenAI may keep request content for up to 30 days for abuse monitoring.";

export const PATTERN_CONSENT_REVOKE_NOTE =
  "You can withdraw this at any time in Context & privacy. Withdrawing stops unfinished and future Pattern generation. An already accepted Pattern stays readable until you delete it.";

interface PatternConsentTermsProps {
  consent: PatternConsent;
  privacyLink?: boolean;
}

export function PatternConsentTerms({ consent, privacyLink }: PatternConsentTermsProps) {
  return (
    <div className="ai-consent-terms">
      <dl className="ai-consent-facts">
        <div>
          <dt>Provider</dt>
          <dd>{consent.provider}</dd>
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
      <ul className="ai-consent-categories">
        {consent.enabled_categories.map((category) => (
          <li key={category}>{patternConsentCategoryLabel(category)}</li>
        ))}
      </ul>
      <p className="ai-consent-note">{PATTERN_CONSENT_INPUT_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_EXCLUSION_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_TRAINING_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_RETENTION_NOTE}</p>
      <p className="ai-consent-note">{PATTERN_CONSENT_REVOKE_NOTE}</p>
      {privacyLink ? (
        <p className="ai-consent-note">
          You can review or withdraw this later in Context & privacy.
        </p>
      ) : null}
    </div>
  );
}
