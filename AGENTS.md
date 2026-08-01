# Repository Guidelines

## Project Structure & Module Organization

`apps/api/` is the Hono Cloudflare Worker, `apps/calc-stub/` the AGPL Swiss Ephemeris service, and `packages/shared/` the shared TypeScript library. Frozen schemas, OpenAPI files, and fixtures live in `contracts/m0/`; D1 migrations in `db/d1/`; normative specs in `spec-bundle/`; licensing decisions in `docs/legal/`. Keep TypeScript tests beside their subjects as `src/**/*.test.ts`.

## Build, Test, and Development Commands

Run commands from the repository root with Node 20+ and Python 3.11+.

- `npm install` installs all workspace dependencies.
- `npm run typecheck` runs strict TypeScript checks across every workspace.
- `npm test` runs calculation, API, schema, OpenAPI, and D1 smoke tests. The calculation pretest may download ephemeris data.
- `npm run build` builds the calculation service and performs a dry-run Worker build.
- `npm run calc:dev` starts the calculation service on port 8080; `npm run dev:api` starts Wrangler on port 8787.
- `npm run db:local` applies `0001_m0_core.sql` to local D1.
- `npm run test:contracts` and `npm run calc:golden` run focused verification lanes.

## Coding Style & Naming Conventions

TypeScript uses strict ES modules, two-space indentation, double quotes, trailing commas, and `.js` suffixes for local imports. Use `camelCase` for variables/functions, `PascalCase` for types, and kebab-case filenames such as `calc-client.ts`. Python follows four-space indentation and `snake_case`. There is no configured formatter or linter, so match nearby code and rely on `npm run typecheck`. Preserve stable schema `$id` values and existing wire-format `snake_case` fields.

## Testing Guidelines

The API uses Vitest; the calculation service uses `node:test` through `tsx`. Name tests `*.test.ts` and add regression coverage beside changed behavior. Contract changes require examples under `contracts/m0/fixtures/valid/` and rejection cases under `fixtures/invalid/`. Keep golden calculations deterministic. No coverage threshold is configured; run all affected lanes and the full suite before review.

## Commit & Pull Request Guidelines

This checkout has no `.git` history, so no convention can be inferred. Use focused, imperative subjects with an area prefix, for example `api: validate chart request`. Pull requests should explain scope and risk, link the issue, and list verification commands. Include screenshots for visible UI changes. Schema changes need fixtures and version/freeze notes; database changes need a migration and compatibility rationale. CI must pass before merge.

## Security, Contracts, and Licensing

Keep local secrets in `.dev.vars` and deployed secrets in `wrangler secret put`; never commit keys or tokens. `AUTH_STUB=1` and `X-User-Id` are local-only. Treat M0 contracts as frozen: breaking required-field, enum, or `$id` changes require a schema-version bump and freeze note. Preserve the calculation service’s AGPL license, `NOTICE`, and source-offer documentation.
