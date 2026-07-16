# ============================================================================
# Multi-stage build for the Next.js UI + optional bot worker.
# Same image can be run as:
#   * `npm run start`       (UI)
#   * `npm run worker`      (Bot worker \u2014 use compose to run alongside UI)
# ============================================================================

FROM node:20-alpine AS deps
# better-sqlite3 needs to compile against Node's headers if there's no prebuilt
# binary for the current alpine + arch combo. python3/make/g++ cover that case.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --loglevel=error --no-audit --no-fund

# ---- Build ---------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next telemetry off in CI \u2014 nothing personal.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner --------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# Install runtime-only OS libraries (better-sqlite3 uses libstdc++ at runtime).
RUN apk add --no-cache libstdc++ && addgroup -S app && adduser -S -G app app

ENV NODE_ENV=production
ENV PORT=5001
ENV NEXT_TELEMETRY_DISABLED=1

# Only copy what production needs.
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
CMD ["npm", "run", "start"]
