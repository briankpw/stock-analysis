# =============================================================================
# Multi-stage build for the Next.js UI + optional bot worker.
#
# The resulting image can run as either:
#   * node server.js       -> UI  (default CMD, uses Next.js standalone output)
#   * node dist/worker.js  -> Bot worker (override CMD in compose / stack)
#
# Design notes:
#
#   * Base image is `node:22-alpine` (default Docker Hub registry, floating
#     tag — a rebuild picks up whatever Alpine / Node 22.x patch is current).
#     Node 22 is the current LTS and the version yahoo-finance2 targets.
#   * `python3 make g++` are needed by node-gyp for better-sqlite3 native
#     compilation; they live only in the build stages and are dropped from
#     the runner image.
#   * `libc6-compat` is required at runtime on Alpine so the prebuilt
#     `better-sqlite3` .node binary can link against glibc-flavoured
#     symbols shipped by node-gyp-build. Without it, the module tries to
#     rebuild from source at import time — which fails because we removed
#     the toolchain from the runner. Symptom: "Error: could not open shared
#     object file" on `require("better-sqlite3")`.
#   * The runner uses Next.js's `output: "standalone"` mode: we copy only
#     `.next/standalone`, `.next/static`, and `public/`. That drops the
#     final image from ~800 MB (dev deps + TS sources) to ~180 MB.
#   * The worker is pre-compiled to `dist/worker.js` in the builder stage
#     so we don't need `tsx` (or its transitive deps) at runtime.
# =============================================================================

# ---- Dependencies (full — includes dev deps for the build) --------------
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --loglevel=error --no-audit --no-fund

# ---- Build --------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js build emits .next/standalone (+ .next/static)
RUN npm run build
# Compile the bot worker entrypoint to plain JS so the runner never needs
# tsx / TypeScript. `--packages=external` keeps every node_modules import
# external so native modules (better-sqlite3) and Node built-ins resolve
# from disk at runtime rather than being inlined. The bundle only inlines
# our own lib/**/*.ts sources.
RUN npx --yes esbuild worker.ts \
      --bundle \
      --platform=node \
      --target=node22 \
      --format=cjs \
      --packages=external \
      --outfile=dist/worker.js

# ---- Production deps only (used by the standalone bundle + worker) ------
FROM node:22-alpine AS proddeps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --loglevel=error --no-audit --no-fund

# ---- Runner --------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# libstdc++ + libc6-compat let the better-sqlite3 prebuilt binary load
# without a source rebuild. tini is our PID-1 signal-handler when the
# container is launched with `init: true` in compose. su-exec drops
# privileges from root to the runtime PUID:PGID in docker-entrypoint.sh.
RUN apk add --no-cache libstdc++ libc6-compat tini su-exec wget

ENV NODE_ENV=production
ENV PORT=5001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Next.js standalone bundle (UI) ------------------------------------
# `standalone/` contains a server.js + a minimal node_modules tree with
# only what next-server needs at runtime (React, next itself, and any
# server components / API-route deps that were traced during build).
# No --chown here: files are owned by root, world-readable. The runtime
# user (whatever PUID/PGID resolves to in the entrypoint) only needs to
# read them, never write. This lets us support arbitrary PUID/PGID
# without a build-time uid guess.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# ---- Worker entrypoint --------------------------------------------------
# The compiled worker sits at /app/dist/worker.js and its dependencies
# (better-sqlite3 + yahoo-finance2 natives, plus the prod-runtime subset
# of everything the worker imports transitively) live in a sibling
# /app/dist/node_modules directory. Node's resolution walks up from
# the requiring file so this stays isolated from the standalone bundle's
# own /app/node_modules directory copied above.
COPY --from=builder /app/dist/worker.js ./dist/worker.js
COPY --from=proddeps /app/node_modules ./dist/node_modules

# /app/data is the only writable path at runtime — chowned to whatever
# PUID:PGID the operator chose by the entrypoint on every start.
RUN mkdir -p /app/data

# ---- Entrypoint --------------------------------------------------------
# Copied last (small, changes often) so the layer cache stays warm.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

# EXPOSE is metadata only — the container still listens on whatever
# `PORT` resolves to at runtime (default 5001, overridable per-deploy).
EXPOSE 5001

# `/api/health` is intentionally lightweight (no DB open, no external
# calls) so the healthcheck can succeed inside `start_period`. It is
# whitelisted by middleware.ts so it works even when APP_TOKEN is set.
#
# Shell form on purpose — Docker doesn't expand env vars inside exec-form
# CMD, so we need /bin/sh to substitute $PORT at check time. This way
# `docker run -e PORT=8080 …` (bypassing Compose) still gets a working
# healthcheck.
HEALTHCHECK --interval=30s --timeout=8s --start-period=25s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-5001}/api/health" || exit 1

# tini reaps zombies and forwards signals to the Node process. Our own
# entrypoint script runs as root, chowns /app/data to $PUID:$PGID, then
# su-exec's into the CMD as that uid — so bind-mounted host directories
# don't need pre-chown gymnastics.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
