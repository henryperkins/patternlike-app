import { useEffect, useId, useRef, useState } from "react";
import type {
  GeocoderConsentResponse,
  PlaceConfidence,
  PlaceResolutionResponse,
  PlaceSearchCandidate,
} from "@patternlike/shared";

import {
  ApiError,
  getGeocoderConsent,
  grantGeocoderConsent,
  newIdempotencyKey,
  resolvePlace,
  revokeGeocoderConsent,
  searchPlaces,
} from "../lib/api-client.js";
import { isGeocoderConsentResponse } from "../lib/geocoder-consent.js";

export const PLACE_SEARCH_DEBOUNCE_MS = 300;

interface PlaceAutocompleteProps {
  value: string;
  selectedPlaceId: string | null;
  selectedConfidence: PlaceConfidence | null;
  onInputChange: (value: string) => void;
  onResolved: (place: PlaceResolutionResponse) => void;
}

type ConsentState =
  | { status: "loading" }
  | { status: "ready"; document: GeocoderConsentResponse }
  | { status: "failed"; message: string };

function locale(): string | null {
  const value = globalThis.navigator?.language?.trim();
  return value || null;
}

export function PlaceAutocomplete({
  value,
  selectedPlaceId,
  selectedConfidence,
  onInputChange,
  onResolved,
}: PlaceAutocompleteProps) {
  const listboxId = useId();
  const sessionToken = useRef(
    globalThis.crypto.randomUUID?.() ?? newIdempotencyKey("place-session"),
  );
  const grantKey = useRef<string | null>(null);
  const revokeKey = useRef<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const [consentState, setConsentState] = useState<ConsentState>({ status: "loading" });
  const [enabled, setEnabled] = useState(false);
  const [busyConsent, setBusyConsent] = useState(false);
  const [candidates, setCandidates] = useState<PlaceSearchCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "empty" | "failed">("idle");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getGeocoderConsent(controller.signal)
      .then((document) => {
        if (controller.signal.aborted) return;
        if (isGeocoderConsentResponse(document)) {
          setConsentState({ status: "ready", document });
        } else {
          setConsentState({
            status: "failed",
            message: "The Google search permission could not be read.",
          });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setConsentState({
            status: "failed",
            message: error instanceof Error
              ? error.message
              : "Google birthplace search is unavailable.",
          });
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    requestController.current?.abort();
    if (!enabled || selectedPlaceId || [...value.trim()].length < 2) {
      setCandidates([]);
      setOpen(false);
      setActiveIndex(-1);
      setSearchState("idle");
      return;
    }

    const controller = new AbortController();
    requestController.current = controller;
    const timer = setTimeout(() => {
      setSearchState("loading");
      void searchPlaces({
        query: value.trim(),
        locale: locale(),
        session_token: sessionToken.current,
      }, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          setCandidates(response.candidates);
          setActiveIndex(-1);
          setOpen(response.candidates.length > 0);
          setSearchState(response.candidates.length > 0 ? "idle" : "empty");
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          if (error instanceof ApiError && error.code === "geocoder_consent_required") {
            setEnabled(false);
          }
          setCandidates([]);
          setOpen(false);
          setSearchState("failed");
        });
    }, PLACE_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, selectedPlaceId, value]);

  const toggleConsent = async (next: boolean) => {
    if (consentState.status !== "ready" || busyConsent) return;
    setBusyConsent(true);
    setProblem(null);
    requestController.current?.abort();
    try {
      if (next) {
        grantKey.current ??= newIdempotencyKey("web-geocoder-consent");
        const document = await grantGeocoderConsent(
          consentState.document.policy_version,
          "onboarding",
          grantKey.current,
        );
        if (!isGeocoderConsentResponse(document)) {
          throw new Error("The Google search permission response could not be verified.");
        }
        grantKey.current = null;
        setConsentState({ status: "ready", document });
        setEnabled(document.status === "granted");
      } else {
        setEnabled(false);
        setCandidates([]);
        setOpen(false);
        revokeKey.current ??= newIdempotencyKey("web-geocoder-consent");
        const document = await revokeGeocoderConsent(
          "onboarding",
          revokeKey.current,
        );
        if (!isGeocoderConsentResponse(document)) {
          throw new Error("The Google search permission response could not be verified.");
        }
        revokeKey.current = null;
        setConsentState({ status: "ready", document });
      }
    } catch (error) {
      setEnabled(false);
      setProblem(error instanceof Error ? error.message : "Google birthplace search is unavailable.");
    } finally {
      setBusyConsent(false);
    }
  };

  const selectCandidate = async (candidate: PlaceSearchCandidate) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setSearchState("loading");
    setOpen(false);
    try {
      const place = await resolvePlace({
        candidate_id: candidate.candidate_id,
        locale: locale(),
        session_token: sessionToken.current,
      }, controller.signal);
      if (!controller.signal.aborted) {
        onResolved(place);
        setCandidates([]);
        setSearchState("idle");
      }
    } catch {
      if (!controller.signal.aborted) setSearchState("failed");
    }
  };

  const activeId = activeIndex >= 0
    ? `${listboxId}-option-${activeIndex}`
    : undefined;

  return (
    <div className="place-autocomplete">
      {consentState.status === "ready" ? (
        <div className="place-autocomplete__consent">
          <p>{consentState.document.disclosure.text}</p>
          <p className="place-autocomplete__links">
            <a href={consentState.document.disclosure.links.patternlike_terms}>Terms</a>{" "}
            <a href={consentState.document.disclosure.links.patternlike_privacy}>Privacy</a>{" "}
            <a href={consentState.document.disclosure.links.google_maps_terms}>Google Maps terms</a>{" "}
            <a href={consentState.document.disclosure.links.google_privacy}>Google privacy</a>
          </p>
          <label className="consent-check consent-check--compact">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busyConsent}
              onChange={(event) => void toggleConsent(event.target.checked)}
            />
            <span className="consent-check__box" aria-hidden="true" />
            <span>Enable optional Google birthplace search</span>
          </label>
        </div>
      ) : (
        <p className="field-help" role="status">
          {consentState.status === "loading"
            ? "Reading the optional Google search permission."
            : consentState.message}
        </p>
      )}

      <label className="field">
        <span>Place label</span>
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          placeholder="City, region, country"
          value={value}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (!open || candidates.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, candidates.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              void selectCandidate(candidates[activeIndex]!);
            } else if (event.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
          autoComplete="off"
        />
      </label>

      {open ? (
        <div className="place-autocomplete__results">
          <ul id={listboxId} role="listbox">
            {candidates.map((candidate, index) => (
              <li
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                key={candidate.candidate_id}
              >
                <button type="button" onClick={() => void selectCandidate(candidate)}>
                  <strong>{candidate.primary_label}</strong>
                  {candidate.secondary_label ? <span>{candidate.secondary_label}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <span className="google-maps-attribution" aria-label="Google Maps" translate="no">
            Google Maps
          </span>
        </div>
      ) : null}

      {selectedPlaceId ? (
        <p className="place-autocomplete__selected">
          Selected with {selectedConfidence ?? "unknown"} confidence ·{" "}
          <span className="google-maps-attribution" aria-label="Google Maps" translate="no">
            Google Maps
          </span>
        </p>
      ) : null}

      <p className="place-autocomplete__status" role="status" aria-live="polite">
        {problem ??
          (searchState === "loading"
            ? "Searching places."
            : searchState === "empty"
              ? "No matching cities found. Enter the place and coordinates manually."
              : searchState === "failed"
                ? "Google search is unavailable. Enter the place and coordinates manually."
                : "")}
      </p>
    </div>
  );
}
