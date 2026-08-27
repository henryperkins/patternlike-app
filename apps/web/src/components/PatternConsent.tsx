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
  "Writing one Pattern for this chart, and nothing else.";

export const PATTERN_CONSENT_PROCESSOR_NOTE =
  "The minimized content below is sent once, to Codex, run by OpenAI, to write one Pattern for this chart.";

export const PATTERN_CONSENT_TRAINING_NOTE =
  "This is not consent to train a model. Research and model training are separate permissions inside Pattern/Like, and granting this leaves both of them off. It does not switch anything off at the processor: whether OpenAI trains on this content is governed by the account and workspace Pattern/Like sends it under, and by the agreement covering that account.";

export const PATTERN_CONSENT_INPUT_NOTE =
  "Birth date, time, place, and coordinates are not sent as fields. Calculated natal features are still sensitive derived data and may support inferences about birth timing. Pattern/Like does not describe the provider packet as anonymous.";

export const PATTERN_CONSENT_EXCLUSION_NOTE =
  "Daily check-ins, life events, journal entries, prior readings, and a biography are not sent. Pattern generation uses chart facts, uncertainty, your confirmed language, and the activated interpretation meanings only.";

export const PATTERN_CONSENT_RETENTION_NOTE =
  "Pattern/Like deletes its own encrypted copies of the request and the response once the generation reaches a terminal state. How long the processor keeps request content is not something this grant controls; it follows the same account and workspace controls and agreement.";

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
      <ul className="ai-consent-categories">
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
      <p className="ai-consent-note">A successful Pattern cannot be rerolled for this chart.</p>
      <p className="ai-consent-note">Deleting your Pattern is permanent.</p>
      {privacyLink ? (
        <p className="ai-consent-note">
          You can review or withdraw this later in Context & privacy.
        </p>
      ) : null}
    </div>
  );
}
