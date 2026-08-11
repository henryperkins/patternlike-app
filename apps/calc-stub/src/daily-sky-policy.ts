/**
 * Versioned constants for the daily-sky scan.
 *
 * Everything here is part of `daily_sky_policy_version`, on the same rule the
 * cycle scanner states: the version must bump whenever the fact vocabulary, the
 * scan grid, the root tolerances, the phase bin boundaries, the suppression
 * rules, or the rendered labels can alter output for otherwise identical inputs.
 * Labels are included because they sit inside the fact identity preimage — a
 * reworded label is a different `dsf_`.
 *
 * The scan is bounded in a way the cycle scanner is not: one local day, at most
 * 25 hours, with both ends supplied. There is no lift chain, no unwrapping
 * epoch, and no lookaround, because nothing here has to prove the outer
 * boundaries of an encounter. That is also why `dailySkyErrorClass` has no
 * `cycle_window_incomplete`.
 */

import type { AspectType } from "@patternlike/shared";
import type { TransitingBody } from "./cycle-policy.js";

export { DAILY_SKY_POLICY_ID, DAILY_SKY_POLICY_VERSION } from "@patternlike/shared";

/**
 * The bodies a daily scan reports.
 *
 * `true_node` is deliberately absent from the anchor set and the event set: its
 * motion is a mean-versus-true artefact at daily resolution, and a "true node
 * ingress" that appears and disappears as it wobbles across a sign boundary is
 * not a fact about anybody's day.
 */
export const DAILY_SKY_BODIES: readonly TransitingBody[] = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;

/**
 * Bodies whose transiting-to-transiting exact aspects are reported.
 *
 * The Moon is excluded on purpose. It forms an exact major aspect to something
 * roughly every few hours, so including it would bury the two or three
 * collective facts that actually distinguish a day under a dozen that do not.
 */
export const COLLECTIVE_ASPECT_BODIES: readonly TransitingBody[] = [
  "sun",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
] as const;

/**
 * The launch collective-event vocabulary: sign ingress plus the five exact major
 * aspects. Stations, eclipses, exact lunations, and seasonal points are declared
 * absent rather than silently inferred — an event class the engine does not
 * calculate must not reach a reading through a label.
 */
export const COLLECTIVE_ASPECTS: readonly AspectType[] = [
  "conjunction",
  "sextile",
  "square",
  "trine",
  "opposition",
] as const;

/**
 * Scan grid, in days.
 *
 * The fastest body is the Moon at ~13.2°/day, so a 15-minute step moves it
 * ~0.14°. Every root bracket is therefore far narrower than the 180° ambiguity
 * bound that makes a `wrap180` sign change unambiguous, with three orders of
 * magnitude of headroom. A coarser grid would be cheaper and would start missing
 * a Moon aspect that forms and separates inside one step.
 */
export const SCAN_STEP_DAYS = 15 / 1440;

/**
 * Bisection stops when the time bracket is this small: 0.05 seconds, in days.
 *
 * Deliberately tighter than the cycle scanner's two seconds. A cycle's
 * `exact_at` is one member of a multi-pass envelope and a second either way is
 * noise; a daily-sky root IS the fact, it is rendered to the second, and that
 * second enters the identity preimage. A two-second bracket leaves the midpoint
 * up to a second from the true root, which rounds to the wrong second about
 * half the time — deterministically wrong, which is worse than noisy.
 *
 * Fifteen extra halvings from a fifteen-minute bracket costs about fifteen
 * ephemeris calls per root, and there are tens of roots in a day.
 */
export const ROOT_TIME_TOLERANCE_DAYS = 0.05 / 86_400;

/**
 * A sample sitting this close to zero is treated as exactly on the root.
 * Matches the cycle scanner's tolerance for the same reason: tight enough to be
 * a real coincidence, loose enough that float noise cannot hide a grid-point
 * root and then find it again by bracketing.
 */
export const ANGULAR_ZERO_TOLERANCE_DEG = 1e-9;

/** Two roots closer than this are the same root seen from two brackets. */
export const ROOT_DEDUPE_TOLERANCE_DAYS = 5 / 86_400;

/**
 * Longitudes are reported to six decimals and instants to the second.
 *
 * Both are declared on every fact rather than assumed, and both are inside the
 * identity preimage: an unrounded double carries bisection noise in its last
 * bits, and two runs that agree to a microdegree would otherwise mint two
 * different `dsf_` handles for one fact.
 */
export const LONGITUDE_DECIMALS = 6;
export const INSTANT_RESOLUTION_SECONDS = 1;
