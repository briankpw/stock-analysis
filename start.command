#!/usr/bin/env bash
# =============================================================================
# One-click launcher for macOS. Double-click in Finder to:
#   1. Install dependencies if `node_modules/` is missing.
#   2. Build if `.next/` is missing.
#   3. Kill any process using port 5001 (stale prior run).
#   4. Start the UI + bot worker together, tail their logs into `./logs/`,
#      and open http://localhost:5001/overview in the default browser.
#
# Port note: 5000 is the default macOS AirPlay Receiver port, so we ship
# with 5001 to avoid the "403 Forbidden \u00b7 Server: AirTunes/..." confusion.
#   5. Ctrl-C in the terminal stops both processes cleanly.
#
# For production Docker deploy, ignore this script and use `docker compose up`.
# =============================================================================

set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

PORT="${PORT:-5001}"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"

echo "==> Key Stock launcher"
echo "    workdir: $APP_DIR"
echo "    port   : $PORT"

# ---- 1. Node.js sanity check -------------------------------------------------
if ! command -v node >/dev/null; then
  echo "\u2717 Node.js is not installed."
  echo "  Install it via https://nodejs.org or 'brew install node@20'."
  read -n 1 -srp "  Press any key to close..."
  exit 1
fi
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "\u2717 Node.js 18+ required (found v$NODE_MAJOR)."
  read -n 1 -srp "  Press any key to close..."
  exit 1
fi
echo "    node   : v$(node -v | sed 's/^v//')"

# ---- 2. Install ---------------------------------------------------------------
if [ ! -d "node_modules" ]; then
  echo "==> Installing dependencies (first run only) \u2014 this can take a minute\u2026"
  npm install --loglevel=error --no-audit --no-fund
fi

# ---- 3. Reap any orphaned Next.js / worker on our port ------------------------
if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "==> Port $PORT already in use \u2014 killing the previous process\u2026"
  lsof -ti tcp:"$PORT" | xargs kill -9 || true
  sleep 1
fi
# Kill any stale `tsx worker.ts` from prior runs.
pkill -f "tsx worker.ts" 2>/dev/null || true

# ---- 4. Build if needed -------------------------------------------------------
if [ ! -d ".next" ]; then
  echo "==> Building production bundle (first run only)\u2026"
  npm run build
fi

# ---- 5. Launch UI + worker ---------------------------------------------------
echo "==> Starting UI + worker\u2026"
npm run start:all 2>&1 | tee "$LOG_DIR/run-$(date +%Y%m%d-%H%M%S).log" &
LAUNCH_PID=$!

# Open the browser once the port is listening.
(
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "http://localhost:$PORT/api/watchlist"; then
      open "http://localhost:$PORT/overview"
      break
    fi
    sleep 1
  done
) &

trap 'echo; echo "==> Stopping\u2026"; kill $LAUNCH_PID 2>/dev/null || true; pkill -P $LAUNCH_PID 2>/dev/null || true; exit 0' INT TERM
wait $LAUNCH_PID
