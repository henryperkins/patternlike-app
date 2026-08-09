import { useState } from "react";
import { Icon } from "./icons.js";

interface SignedOutProps {
  /** Redirects to Auth0; resolves only if the redirect failed to start. */
  onSignIn: () => Promise<void>;
  /** A failed exchange from a previous redirect, surfaced on return. */
  error?: string | null;
}

/**
 * The whole product for a caller with no session.
 *
 * Deliberately not a marketing page: it states what the app will ask for and
 * what it does with it, because the very next screen after sign-in asks for a
 * birth date, time, and place. Burying that until after authentication would
 * make consent a formality collected too late to matter.
 */
export function SignedOut({ onSignIn, error }: SignedOutProps) {
  const [pending, setPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const signIn = async () => {
    setPending(true);
    setStartError(null);
    try {
      await onSignIn();
      // A successful call navigates away; reaching here means the redirect
      // never started, so the button must not stay stuck in its pending state.
      setPending(false);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Sign-in could not be started.");
      setPending(false);
    }
  };

  const message = startError ?? error ?? null;

  return (
    <section className="signin-page page-enter">
      <span className="wordmark__mark signin-page__mark" aria-hidden="true">
        <span />
      </span>

      <p className="eyebrow">Pattern/Like</p>
      <h1>Calculated, not invented.</h1>
      <p>
        Positions come from Swiss Ephemeris. Nothing here is generated about you
        until you provide a birth date, and every claim the app makes is traceable
        to the calculation that produced it.
      </p>

      <button
        className="button button--primary"
        type="button"
        onClick={() => void signIn()}
        disabled={pending}
      >
        {pending ? "Redirecting..." : "Sign in"} <Icon name="arrow" />
      </button>

      {message ? (
        <p className="signin-page__error" role="alert">
          {message}
        </p>
      ) : null}

      <ul className="signin-page__promises">
        <li>
          <Icon name="shield" /> Birth date, time, and place are encrypted before
          they are stored.
        </li>
        <li>
          <Icon name="check" /> The chart endpoint never returns them back.
        </li>
        <li>
          <Icon name="privacy" /> Export or delete everything, whenever.
        </li>
      </ul>

      {import.meta.env.DEV ? (
        <small>
          Development: the API accepts <code>X-User-Id</code> while
          <code> AUTH_STUB=1</code>, but that header names a user who must already
          exist. A 401 here means no seeded user, not a broken sign-in.
        </small>
      ) : null}
    </section>
  );
}
