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
 * The processor, purpose, policy version, and category list are never written
 * here: they arrive from the server with the policy the reader is agreeing to.
 * Only the model id is deliberately absent from consent copy — the exact model
 * belongs to the generation record, and coupling agreement to it would mean a
 * routine version bump silently invalidated everyone's consent.
 *
 * The processor and the generation service are separate facts and are shown
 * separately. OpenAI is who processes the data; Codex is what writes the prose.
 * Conflating them was survivable while the two were the same request; it is not
 * survivable now that the reader's evidence names one and their consent names
 * the other.
 */

export const AI_CONSENT_PURPOSE =
  "Writing your daily reading, and nothing else.";

export const AI_CONSENT_SERVICE_NOTE =
  "Your reading is written by Codex, a service operated by OpenAI. What is sent goes there for that one purpose and is used for nothing else.";

/**
 * The training statement, corrected.
 *
 * The old sentence said granting this consent left training off, which was
 * never something a reader's grant controlled. The setting lives on the account
 * Pattern/Like's runner signs in with, and saying so is the difference between
 * a promise the product can keep and one it cannot.
 */
export const AI_CONSENT_TRAINING_NOTE =
  "This is not consent to train a model. Pattern/Like requires training and data sharing to be switched off on the account its Codex runner signs in with — but that is Pattern/Like's setting to hold, and granting this does not change anything in an account of your own.";

export const AI_CONSENT_FREE_TEXT_NOTE =
  "Personal context you enable is sent as you wrote it, so it can name people and places. The product does not claim that text is anonymous.";

/**
 * The retention statement, corrected.
 *
 * `store: false` is an API request parameter. A Codex runner signed in to an
 * account has no equivalent, so the promise is replaced by what is actually
 * true: OpenAI's retention follows that account's agreement and settings, and
 * the only retention this product controls is its own.
 */
export const AI_CONSENT_RETENTION_NOTE =
  "How long OpenAI keeps what is sent is governed by the agreement and settings on that account, not by this screen. Pattern/Like deletes its own encrypted copy of each request and response once the reading it belongs to is finished.";

export const AI_CONSENT_REVOKE_NOTE =
  "You can withdraw this at any time in Context & privacy. Withdrawing stops any reading still being written as well as every future one; readings already published stay readable until you export or delete them.";

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

      <p className="ai-consent-note">{AI_CONSENT_SERVICE_NOTE}</p>
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
