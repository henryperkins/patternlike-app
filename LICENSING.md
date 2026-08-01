# Licensing

This repository is **not** under a single license. Terms differ by directory.

> Not legal advice. This file records the engineering implementation of the
> decision in [`docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md`](docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md)
> (§3, "Scope of AGPL in this monorepo"). Counsel has **not** reviewed it. The
> boundary between the AGPL calculation service and the rest of the product is
> the open question flagged in that record.

## By directory

| Path | Terms |
| --- | --- |
| [`apps/calc-stub/`](apps/calc-stub/) | **AGPL-3.0-or-later.** Links Swiss Ephemeris and the `sweph` binding. Full text: [`apps/calc-stub/LICENSE`](apps/calc-stub/LICENSE). Copyright and scope notice: [`apps/calc-stub/COPYRIGHT`](apps/calc-stub/COPYRIGHT). |
| `apps/calc-stub/data/ephe/` | Swiss Ephemeris data, distributed under Swiss Ephemeris / AGPL terms. Not vendored — downloaded and verified against [`apps/calc-stub/ephemeris.lock.json`](apps/calc-stub/ephemeris.lock.json). |
| `apps/api/` | **All rights reserved.** Not relicensed under AGPL. |
| `packages/shared/` | **All rights reserved.** Not relicensed under AGPL. |
| `contracts/`, `db/`, `docs/`, `spec-bundle/` | **All rights reserved.** |
| Third-party dependencies | Their own licenses. See [`NOTICE`](NOTICE). |

"All rights reserved" is the default position recorded in the decision, not an
affirmative choice to keep these parts closed. If counsel maps the AGPL boundary
wider, this table and the affected `package.json` `license` fields change
together.

## The unresolved boundary

`apps/calc-stub` depends on `@patternlike/shared`. Where a recipient exercises
AGPL rights over the calculation service, the Corresponding Source they are owed
includes whatever is needed to build and run it — which reaches into
`packages/shared`. The decision record's engineering default is to treat **calc
as the AGPL network service** with a documented source offer, and to have
counsel map the rest. That mapping has not happened.

Two consequences worth knowing before public launch:

1. **`packages/shared` may need AGPL-compatible terms** (AGPL itself, or a
   permissive license such as MIT that can be combined into an AGPL work while
   remaining usable by the proprietary API). This is a decision for the copyright
   holder, not something the code determines.
2. **AGPL §13 obligations are triggered by deployment, not by this repository.**
   Publishing the source here helps satisfy them but is not by itself the offer;
   see [`docs/legal/AGPL_SOURCE_OFFER.md`](docs/legal/AGPL_SOURCE_OFFER.md).

## Why there is no root `LICENSE`

A root `LICENSE` file would be read — by GitHub, by tooling, and by humans — as
covering the whole repository. Only `apps/calc-stub` is AGPL. Placing the AGPL
text at the root would over-grant rights to `apps/api`, `packages/shared`, and
the specification bundle.

The cost is that GitHub's repository summary shows no license. That is accurate:
there is no single repository license.
