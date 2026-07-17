# =============================================================================
# Multi-stage build for the Next.js UI + optional bot worker.
#
# The resulting image can run as either:
#   * node server.js       -> UI  (default CMD, uses Next.js standalone output)
#   * node dist/worker.js  -> Bot worker (override CMD in compose / stack)
#
# Design notes:
#
#   * We pin to a specific patch tag (not the moving `22-alpine`) so a
#     rebuild after an upstream base-image push doesn't silently change
#     musl / OpenSSL / etc. from under us.
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
FROM node:22.11.0-alpine3.20 AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --loglevel=error --no-audit --no-fund

# ---- Build --------------------------------------------------------------
FROM node:22.11.0-alpine3.20 AS builder
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
FROM node:22.11.0-alpine3.20 AS proddeps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --loglevel=error --no-audit --no-fund

# ---- Runner --------------------------------------------------------------
FROM node:22.11.0-alpine3.20 AS runner
WORKDIR /app

# libstdc++ + libc6-compat let the better-sqlite3 prebuilt binary load
# without a source rebuild. tini is our PID-1 signal-handler when the
# container is launched with `init: true` in compose.
RUN apk add --no-cache libstdc++ libc6-compat tini wget \
 && addgroup -S app && adduser -S -G app app

ENV NODE_ENV=production
ENV PORT=5001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Next.js standalone bundle (UI) ------------------------------------
# `standalone/` contains a server.js + a minimal node_modules tree with
# only what next-server needs at runtime (React, next itself, and any
# server components / API-route deps that were traced during build).
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

# ---- Worker entrypoint --------------------------------------------------
# The compiled worker sits at /app/dist/worker.js and its dependencies
# (better-sqlite3 + yahoo-finance2 natives, plus the prod-runtime subset
# of everything the worker imports transitively) live in a sibling
# /app/dist/node_modules directory. Node's resolution walks up from
# the requiring file so this stays isolated from the standalone bundle's
# own /app/node_modules directory copied above.
COPY --from=builder --chown=app:app /app/dist/worker.js ./dist/worker.js
COPY --from=proddeps --chown=app:app /app/node_modules ./dist/node_modules

RUN mkdir -p /app/data && chown -R app:app /app/data

USER app

EXPOSE 5001

# `/api/health` is intentionally lightweight (no DB open, no external
# calls) so the healthcheck can succeed inside `start_period`. It is
# whitelisted by middleware.ts so it works even when APP_TOKEN is set.
HEALTHCHECK --interval=30s --timeout=8s --start-period=25s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5001/api/health || exit 1

# tini reaps zombies and forwards signals to the Node process, so
# `docker stop` triggers a clean SIGTERM inside `runForever` etc.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
