# Zodiac observatory

The user asked to tie the existing observatory more closely to the horoscope, zodiac, and Pattern experience. This extends the existing local design on `codex/portrait-observatory`; it is not a new product identity. The supplied direction authorizes reversible implementation. The concrete scope below is an implementation decision, not a claim that the user approved a separate composition.

## Experience

A bronze zodiac instrument replaces the central tree over the existing water court. Twelve sign sectors and calibrated ticks give the court an unmistakably celestial center. The surrounding garden, architectural material palette, four saved chapter objects, and reading desks remain.

The visitor can move between **Your Pattern** and **Your sky**. Your sky frames the instrument and pairs it with an accessible Sun, Moon, and rising selector. Choosing an available placement highlights its true zodiac sector and marker, and displays its calculated sign and degree with any qualification. The instrument depicts ecliptic position, not planetary distance, size, a live sky, or the current Moon phase. A saved Sun sign without a longitude can highlight a sector but must never acquire a made-up degree.

Your Pattern returns to the selected chapter, perspective, and reading position. Chapter destinations, comparison, the guide, original images, and the complete reading remain intact. Public chapters have no claim-level planet mapping: do not assign chapters to signs, infer aspects, or attribute paragraphs to planets. The account can link to the existing Today experience; do not fabricate daily horoscope content inside this natal view.

## Data and privacy

Add a minimized frontend `PortraitSky` projection of the already-loaded chart, passed separately from the immutable portrait manifest. Require an active chart with matching identity. Include only Sun, eligible Moon, eligible ascendant, sign/degree, permitted house, qualification, and the user-facing uncertainty summary. Do not include birth values, location, timezone, user IDs, fingerprints, provider packets, or internal evidence aliases.

Unknown birth time or `moon_time_sensitive` suppression removes the Moon placement entirely. Rising requires supported angles and a finite ascendant. Unknown time and suppressed houses remove house numbers. Approximate time remains visibly qualified. Missing data stays missing; the complete Pattern remains usable independently.

## Implementation boundaries

No new API, database migration, generation request, dependency, or saved-asset contract change. Implement owned Three.js geometry in a separate instrument module. Keep native controls usable without WebGL, respect reduced motion and low-power mode, and dispose the instrument with the parent runtime. Scene picking and labels respect visible geometry. Sun/Moon/rising selections never alter chapter prose or source bindings.

## Verification

Regression tests cover minimized chart projection, identity mismatch, Moon/angle/house suppression, approximate qualifications, exact marker angles, selection, source preservation, navigation restoration, and resource disposal. Inspect desktop and phone with fictional chart facts clearly identified as examples. Run affected tests and the full `npm run ci:local` after final code edits; record real-device and signed-in verification limits separately.
