# AGPL corresponding source offer

**Applies to:** Pattern-Like **calculation service** (`apps/calc-stub`) and any
deployment that links Swiss Ephemeris under the **AGPL public path**.

**Decision:** `docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md` (AGPL).

> Not legal advice. AGPL §13 requires offering Corresponding Source to users
> who interact with the program remotely over a network. Counsel should validate
> this process for your deployment topology.

---

## 1. What we offer

Corresponding Source for the AGPL-covered calculation service, including:

- TypeScript/JavaScript sources under `apps/calc-stub/`
- Build/run scripts needed to produce the deployed calc image
- Build instructions (Dockerfile, npm scripts)
- Pinned dependency versions (`package-lock.json` / workspace lockfile)
- Instructions to obtain Swiss Ephemeris data files (`npm run ephe:download`)

We do **not** claim this offer automatically covers proprietary mobile apps or
non-AGPL packages unless counsel expands the AGPL boundary.

---

## 2. How to obtain source (public git)

Preferred method when the repository is public:

1. Clone the git repository at the **same tag or commit** as the deployed
   calc container / release.
2. Directory: `apps/calc-stub/`
3. Install: from monorepo root, `npm install`
4. Ephemeris data: `npm run ephe:download -w @patternlike/calc-stub`
5. Run: `npm run calc:dev` or build the Docker image from
   `apps/calc-stub/Dockerfile`

### Release tagging convention

| Deployed artifact | Source pointer |
| --- | --- |
| Git tag `vX.Y.Z` | Tag `vX.Y.Z` on the public (or offer) repository |
| Container label `org.opencontainers.image.revision` | Git commit SHA |
| `/v1/engine` / `/health` | Report `se_version`, `wrapper`, and ideally `git_sha` |

---

## 3. Written offer (if source is not continuously public)

If the full source is not available from a network server to the public at no
charge, operators must provide a written offer valid for at least three years
(or as long as support/spare parts are offered for that product version—see
AGPL for exact conditions) to supply Corresponding Source on a durable medium
or equivalent network download.

**Operator contact for source requests (fill before public launch):**

| Field | Value |
| --- | --- |
| Email | `legal@example.com` *(replace)* |
| Subject line | `AGPL source request — Pattern-Like calc` |
| Max response time | 7 business days (target) |

---

## 4. User-facing notice (copy for Settings / legal page)

Suggested text:

> Chart calculations use the Swiss Ephemeris library under the GNU Affero
> General Public License. Corresponding source for our calculation service is
> available as described at:  
> [link to this document or /legal/source]  
> Swiss Ephemeris: https://www.astro.com/swisseph/

---

## 5. Operator checklist each production release

- [ ] Tag git commit matching deployed calc image  
- [ ] Publish or retain source per §2/§3  
- [ ] Update user-facing legal link if URL changes  
- [ ] Record ephe file hashes in release notes  
- [ ] Confirm `SE_LICENSE_MODE=agpl` in production  
