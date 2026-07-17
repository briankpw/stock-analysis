# =============================================================================
# Multi-stage build for the Next.js UI + optional bot worker.
# The resulting image can run as either:
#   * npm run start   -> UI  (default CMD)
#   * npm run worker  -> Bot worker (override CMD in compose / Portainer stack)
#
# yahoo-finance2 >= 3.15 requires Node 22+, so we standardise on node:22-alpine
# everywhere. python3/make/g++ are needed by node-gyp for better-sqlite3 native
# compilation; they live only in the build stages and are dropped from the
# runner image.
# =============================================================================

# ---- Dependencies --------------------------------------------------------
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --loglevel=error --no-audit --no-fund

# ---- Build ---------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner --------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# libstdc++ is the only runtime dep for the better-sqlite3 prebuilt binary;
# wget is used by the healthcheck we declare below.
RUN apk add --no-cache libstdc++ wget \
 && addgroup -S app && adduser -S -G app app

ENV NODE_ENV=production
ENV PORT=5001
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
# Runtime-only TypeScript sources (used by the worker via tsx).
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/worker.ts ./worker.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/data && chown -R app:app /app
USER app

EXPOSE 5001

# Local healthcheck — /api/watchlist is cheap and returns JSON immediately once
# the server is ready. Compose / Portainer can override this if they prefer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5001/api/watchlist || exit 1

CMD ["npm", "run", "start"]
