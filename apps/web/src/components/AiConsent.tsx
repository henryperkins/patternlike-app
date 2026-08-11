import type { AiSynthesisConsent } from "../lib/api-client.js";
import { aiConsentCategoryLabel } from "../lib/reading-format.js";

/**
 * What the reader is told before anything is sent to the publisher.
 *
 * One module, because two surfaces ask for this consent — the Today gate before
 * the first reading, and the Context & Privacy control afterwards — and a reader
 * who grants it on one screen and reviews it on the other must be reading the
 * same sentences. Two copies would drift, and the half that drifted would be the
 * half nobody re-read.
 *
 * The provider, purpose, policy version, and category list are never written
 * here: they arrive from the server with the policy the reader is agreeing to.
 * Only the model id is deliberately absent from consent copy — the exact model
 * belongs to the generation record, and coupling agreement to it would mean a
 * routine version bump silently invalidated everyone's consent.
 */

export const AI_CONSENT_PURPOSE =
  "Writing your daily reading, and nothing else.";

export const AI_CONSENT_TRAINING_NOTE =
  "This is not consent to train a model. Research and model training are separate permissions, and granting this leaves both of them off.";

export const AI_CONSENT_FREE_TEXT_NOTE =
  "Personal context you enable is sent as you wrote it, so it can name people and places. The product does not claim that text is anonymous.";

export const AI_CONSENT_RETENTION_NOTE =
  "Requests are sent with provider-side storage turned off. That is not zero retention: OpenAI may keep request content for up to 30 days for abuse monitoring.";

export const AI_CONSENT_REVOKE_NOTE =
  "You can withdraw this at any time in Context & privacy. Withdrawing stops all future readings from being generated; readings already published stay readable until you export or delete them.";

/**
 * The categories, the lanes they are limited to, and the three sentences that
 * qualify them. Rendered identically on both surfaces.
 *
 * `privacyLink` is omitted on the privacy surface itself — a link from the
 * details to the details is a dead end, not a courtesy.
 */
export function AiConsentTerms({
  consent,
  privacyLink = false,
}: {
  consent: AiSynthesisConsent;
  privacyLink?: boolean;
}) {
  return (
    <div className="ai-consent-terms">
      <dl className="ai-consent-facts">
        <div>
          <dt>Processor</dt>
          <dd>{consent.provider}</dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd>{AI_CONSENT_PURPOSE}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd className="ai-consent-facts__code">v{consent.policy_version}</dd>
        </div>
      </dl>

      <p className="kicker">What may be sent</p>
      <ul className="ai-consent-categories">
        {consent.enabled_categories.map((category) => (
          <li key={category}>{aiConsentCategoryLabel(category)}</li>
        ))}
      </ul>

      <p className="ai-consent-note">{AI_CONSENT_FREE_TEXT_NOTE}</p>
      <p className="ai-consent-note">{AI_CONSENT_TRAINING_NOTE}</p>
      <p className="ai-consent-note">{AI_CONSENT_RETENTION_NOTE}</p>
      <p className="ai-consent-note">{AI_CONSENT_REVOKE_NOTE}</p>

      {privacyLink ? (
        <p className="ai-consent-note">
          <a href="#privacy">Read the full privacy details</a>
        </p>
      ) : null}
    </div>
  );
}
