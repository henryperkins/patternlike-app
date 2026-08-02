# Static build of the Pattern/Like web PWA, served by nginx.
#
# IMPORTANT — build context:
#   The build context is the repository ROOT, not apps/web (same rule as the
#   calc service). The build copies root package.json/package-lock.json,
#   tsconfig.base.json, and packages/shared, so the context must never be
#   changed to apps/web.
#
# No VITE_API_BASE_URL is baked in: the client calls same-origin /v1, which
# has no backend on this host until the production API exists.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm install --workspace=@patternlike/web --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @patternlike/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

LABEL org.opencontainers.image.title="patternlike-web"
LABEL org.opencontainers.image.description="Pattern/Like web PWA (static)"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8080/ || exit 1
