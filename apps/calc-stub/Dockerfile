# Portable OCI image: Swiss Ephemeris calculation service
# Deployable to Cloudflare Containers and Fly Machines (same image).
#
# License: AGPL-3.0-or-later (M0 decision: public SE path).
# Swiss Ephemeris + sweph under AGPL. See LICENSE, NOTICE, docs/legal/.

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/calc-stub/package.json apps/calc-stub/
RUN npm install --workspace=@patternlike/calc-stub --include-workspace-root=false 2>/dev/null \
  || (cd apps/calc-stub && npm install)

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV SE_EPHE_PATH=/app/data/ephe
ENV SE_LICENSE_MODE=agpl
ENV ENVIRONMENT=production

COPY --from=deps /repo/node_modules /app/node_modules
COPY packages/shared /app/packages/shared
COPY apps/calc-stub /app/apps/calc-stub
WORKDIR /app/apps/calc-stub

# Ephemeris files must be present (download at build or COPY pre-fetched data/ephe)
RUN npm run ephe:download || true
RUN test -f data/ephe/sepl_18.se1 && test -f data/ephe/semo_18.se1

LABEL org.opencontainers.image.title="patternlike-calc"
LABEL org.opencontainers.image.description="Swiss Ephemeris 2.10.03 calculation service"
LABEL se.version="2.10.03"
LABEL se.wrapper="sweph@2.10.3-7"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server.ts"]
