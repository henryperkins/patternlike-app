# Swiss Ephemeris licensing decision (M0 Milestone 0)

**Status:** `DECIDED` — **AGPL (public SE)**  
**Product:** Pattern-Like Astrology App  
**Calc pin:** Swiss Ephemeris **2.10.03** via Node binding **`sweph@2.10.3-7`**  
**Spec:** Product platform v0.2 — *Resolve Swiss Ephemeris licensing before public activation*  
**Date opened:** 2026-07-31  
**Date decided:** 2026-07-31  
**Decision maker:** Product owner (session decision: “AGPL (public SE)”)  
**Owner:** Product + legal (engineering implements the chosen path)

> This document is an engineering decision record, not legal advice. Confirm terms on [astro.com/swisseph](https://www.astro.com/swisseph/) and with counsel before public distribution. AGPL network copyleft has material implications for app stores and proprietary clients.

---

## 1. Decision summary

| Item | Choice |
| --- | --- |
| **Path** | **Option B — AGPL public Swiss Ephemeris** |
| **Astrodienst professional license** | **Not purchased** (not required for this path) |
| **`SE_LICENSE_MODE`** | **`agpl`** |
| **Calc service license** | **AGPL-3.0-or-later** (`apps/calc-stub/LICENSE`) |
| **Binding** | `sweph` under **AGPL-3.0-or-later** (no commercial SE → no LGPL branch) |
| **Public activation** | Allowed **only after** AGPL obligations in §6 are satisfied (source offer, notices, counsel review of store distribution) |

Production may set `SE_LICENSE_MODE=agpl` and `ENVIRONMENT=production`. The process boot gate no longer blocks on `pending`. Remaining blockers are **compliance** (source offer, notices, store strategy), not “undecided license.”

---

## 2. Why AGPL was chosen

- No Astrodienst professional fee.  
- Aligns with free public SE + AGPL `sweph` without dual-license switching.  
- Fits a product that can operate as **source-available / AGPL-compliant** network software.

### Tradeoffs accepted

- **Copyleft:** Modifications and network use of the SE-linked service typically require offering corresponding source under AGPL.  
- **App stores:** Proprietary closed mobile binaries calling a closed backend conflict with AGPL unless architecture and counsel define a compliant boundary. Re-evaluate store distribution under AGPL.  
- **Contributors / employees:** All calc-service contributions must be compatible with AGPL-3.0.

---

## 3. Scope of AGPL in this monorepo (engineering map)

Counsel should confirm the final boundary. Engineering default:

| Component | License posture under this decision |
| --- | --- |
| **`apps/calc-stub`** (Swiss Ephemeris process) | **AGPL-3.0-or-later** — links SE + sweph |
| **SE data files** (`data/ephe/*`) | Distributed under Swiss Ephemeris / AGPL terms; provenance documented |
| **`apps/api`**, **`packages/shared`**, mobile (future) | **Not auto-relicensed** in this commit; if they form one combined AGPL work with calc over the network, counsel must map obligations. Prefer treating **calc as the AGPL network service** with a documented source offer. |
| **Third-party** (luxon, hono, wrangler, …) | Remain under their own licenses (see `NOTICE`) |

If counsel requires the entire monorepo under AGPL, update root `LICENSE` and this table in a follow-up PR.

---

## 4. Background (dual license reference)

### Swiss Ephemeris (Astrodienst)

- Public path: AGPL-compatible public license (see astro.com).  
- Professional path: paid proprietary use — **not selected**.

### `sweph` binding

- Without commercial SE: **AGPL-3.0-or-later**.  
- With commercial SE: LGPL-3.0-or-later — **N/A**.

---

## 5. Decision record

| Field | Value |
| --- | --- |
| **Decision** | **`AGPL`** |
| **Decided by** | Product (user directive 2026-07-31) |
| **Date** | 2026-07-31 |
| **Counsel reviewed** | **No** (pending before public store launch) |
| **Astrodienst contract edition** | N/A (public AGPL path) |
| **License / invoice reference** | N/A |
| **SE version authorized** | 2.10.03 |
| **Binding** | sweph@2.10.3-7 |
| **SE_LICENSE_MODE** | **`agpl`** |
| **Public activation authorized** | **Conditional** — license mode OK; complete §6 checklist + counsel before marketing “production live” to end users |
| **Notes** | Source offer process: `docs/legal/AGPL_SOURCE_OFFER.md`. Calc LICENSE: `apps/calc-stub/LICENSE`. |

### Sign-off

| Role | Name | Date |
| --- | --- | --- |
| Product | (session decision) | 2026-07-31 |
| Engineering | Implemented record + mode + notices | 2026-07-31 |
| Legal / counsel | | |

---

## 6. AGPL implementation checklist

### Done in repo

- [x] Record decision as `AGPL`  
- [x] Set `SE_LICENSE_MODE=agpl` (defaults / wrangler / health)  
- [x] `apps/calc-stub/LICENSE` (AGPL-3.0-or-later)  
- [x] `NOTICE` (SE + sweph attribution)  
- [x] Source offer process documented (`docs/legal/AGPL_SOURCE_OFFER.md`)  
- [x] `/health` reports `se_license_mode: agpl`  

### Still required before public end-user launch

- [ ] Counsel maps AGPL network obligations to Workers API + any mobile clients  
- [ ] User-facing legal page links to source offer (website / app settings)  
- [ ] App store distribution strategy reviewed under AGPL  
- [ ] CONTRIBUTING / CLA policy if accepting external patches to calc  
- [ ] Release process includes source tarball or public git tag matching deployed calc image  

### Always

- [x] Pin SE version + ephe download script  
- [ ] Pin ephe file SHA-256 in each release artifact  
- [x] No LLM-invented chart facts  

---

## 7. Runtime config

| Env | Meaning |
| --- | --- |
| `SE_LICENSE_MODE=agpl` | **Selected path** — production boot allowed |
| `SE_LICENSE_MODE=pending` | Legacy block if someone reverts |
| `SE_LICENSE_MODE=professional` | Only if decision is later reversed and commercial license purchased |
| `ENVIRONMENT=production` | Allowed with `agpl` |

---

## 8. Related paths

| Path | Role |
| --- | --- |
| `apps/calc-stub/LICENSE` | AGPL-3.0 for calc service |
| `NOTICE` | Third-party / SE notices |
| `docs/legal/AGPL_SOURCE_OFFER.md` | How users obtain corresponding source |
| `docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md` | This record |
| `apps/calc-stub/src/license-mode.ts` | Runtime mode gate |
