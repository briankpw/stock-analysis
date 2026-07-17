# Portainer deployment

This folder contains everything you need to run **Key Stock** on a Docker host managed by Portainer.

```
deploy/portainer/
├── stack.yml            # Compose file — paste this into a Portainer stack
├── stack.env.example    # Copy into Portainer's env vars (Advanced mode)
└── README.md            # You are here
```

The stack runs two containers that share a single SQLite database on a persistent named volume:

| Service | Image           | Purpose                                                       |
| ------- | --------------- | ------------------------------------------------------------- |
| `ui`    | `${IMAGE}`      | Next.js 15 dashboard on port `5001`                           |
| `worker`| `${IMAGE}`      | Bot loop that polls Yahoo + SEC / House feeds and fires alerts |

Both containers mount `${STACK_NAME}_data:/app/data`, which holds `bot.db` (paper trading, watchlist, signals, portfolio presets, notifications).

Both containers ship hardened defaults: `init: true` (tini as PID 1 for clean signal handling), `read_only: true` root filesystem (only `/app/data` and `/tmp` are writable), `cap_drop: [ALL]`, `no-new-privileges`, per-service memory limits (`ui: 512 MB`, `worker: 768 MB`), and log rotation (`json-file`, 10 MB × 3).

---

## Prerequisites

- A Portainer instance connected to a Docker host (Linux, x86_64 or arm64).
- The host has outbound HTTPS access to:
  - `query1.finance.yahoo.com` (prices)
  - `data.sec.gov`, `www.sec.gov`, `efts.sec.gov` (fund managers, entity search)
  - `disclosures-clerk.house.gov` (politician filings)
  - `api.telegram.org` (only if you enable Telegram alerts)

---

## Option A — Deploy from Git (recommended)

Portainer builds the image itself, straight from this repository, on every stack redeploy.

1. **Portainer -> Stacks -> Add stack -> Repository**
2. Fill the form:
   - **Name**: `key-stock`
   - **Repository URL**: your git remote, e.g. `https://github.com/<owner>/key-stock-node`
   - **Repository reference**: `refs/heads/main` (or the branch you deploy)
   - **Compose path**: `deploy/portainer/stack.yml`
   - **Authentication**: enable if the repo is private
3. Scroll to **Environment variables -> Advanced mode**, paste the contents of `stack.env.example`, and edit any values you want (see [Environment variables](#environment-variables) below). At minimum you should change `SEC_USER_AGENT` to a real contact email.
4. Click **Deploy the stack**. Portainer clones the repo, builds the image from the root `Dockerfile`, and starts both containers. First build takes 2–4 minutes.
5. Visit `http://<host>:5001` — the Next.js UI should load immediately.

To upgrade later, click **Pull and redeploy** on the stack page; Portainer will `git pull`, rebuild the image, and restart both services.

## Option B — Deploy from a prebuilt registry image

Use this if you build the image in CI and push it to a registry (GHCR, Docker Hub, Harbor, …). Portainer just pulls it — no build on the host.

1. Build & push once from a machine that has Docker:
   ```bash
   docker build -t ghcr.io/<owner>/key-stock:latest .
   docker push  ghcr.io/<owner>/key-stock:latest
   ```
2. **Portainer -> Stacks -> Add stack -> Web editor**, paste `stack.yml`.
3. In **Environment variables -> Advanced mode**, paste `stack.env.example` and set:
   ```
   IMAGE=ghcr.io/<owner>/key-stock:latest
   ```
4. Click **Deploy the stack**. Portainer skips the `build:` blocks because `image:` resolves to the registry ref, pulls the image, and starts the stack.

To upgrade, push a new tag and click **Pull and redeploy**.

---

## Environment variables

All variables are optional — `stack.yml` provides safe defaults. See `stack.env.example` for the full annotated list. Highlights:

| Variable                | Default                                 | Notes                                                         |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `STACK_NAME`              | `key-stock`                             | Prefix for container / volume / network names.                                    |
| `IMAGE`                   | `key-stock:latest`                      | Set to a registry ref (prefer a version tag over `latest`) to skip the build.     |
| `UI_PORT`                 | `5001`                                  | Host port. Change if `5001` collides with something else.                         |
| `TZ`                      | `UTC`                                   | e.g. `Asia/Singapore`, `America/New_York`.                                        |
| `APP_TOKEN`               | *(empty)*                               | Enables bearer-token auth for `/api/*`. **Set this before any public exposure.**  |
| `STOCK_TICKER`            | `KEYS`                                  | Default active ticker on first load.                                              |
| `SEC_USER_AGENT`          | `Key Stock Dashboard research@example.com` | **Must be a real contact email.** The app refuses to start if this contains `example.com`. |
| `TELEGRAM_BOT_TOKEN`      | *(empty)*                               | Bot token from [@BotFather](https://t.me/BotFather). See below for the secret-file alternative. |
| `TELEGRAM_BOT_TOKEN_FILE` | *(empty)*                               | Path to a mounted secret file (e.g. `/run/secrets/telegram_bot_token`). Takes precedence over the inline var. |
| `TELEGRAM_CHAT_ID`        | *(empty)*                               | Obtain from [@userinfobot](https://t.me/userinfobot).                             |

Leaving `TELEGRAM_*` blank disables outbound alerts — the worker still records signals to SQLite, they just aren't pushed anywhere.

### Bearer-token auth (`APP_TOKEN`)

When you set `APP_TOKEN=<something-long-and-random>`, every request to `/api/*` must present it as either:

```
Authorization: Bearer <APP_TOKEN>
```

or a browser cookie:

```
Cookie: app_token=<APP_TOKEN>
```

The one exception is `GET /api/health`, which is always public so Docker's healthcheck keeps working.

Generate a token with `openssl rand -hex 32`. Store it in the stack env, then set the same cookie in your browser (DevTools -> Application -> Cookies) or put your reverse proxy in charge of appending the header. Leave `APP_TOKEN` empty for a wide-open local install.

### Telegram token as a Docker secret

For production, prefer the file-based path over the inline env var:

```yaml
# Adjacent compose override, e.g. deploy/portainer/stack.override.yml
services:
  ui:
    secrets:
      - telegram_bot_token
  worker:
    secrets:
      - telegram_bot_token
    environment:
      TELEGRAM_BOT_TOKEN_FILE: /run/secrets/telegram_bot_token
secrets:
  telegram_bot_token:
    file: /path/on/host/telegram_bot_token
```

The app reads `TELEGRAM_BOT_TOKEN_FILE` first, falls back to `TELEGRAM_BOT_TOKEN`, and only uses the value in memory.

---

## Reverse proxy / HTTPS

The container only speaks plain HTTP on port `5001`. To serve it on HTTPS, put a reverse proxy in front (Caddy, Traefik, nginx, Cloudflare Tunnel, …). Sample Caddy snippet:

```
stocks.example.com {
    reverse_proxy 127.0.0.1:5001
}
```

If you proxy under a sub-path, override `NEXT_PUBLIC_PWA_SW_URL` accordingly (see the app README).

---

## Operations

### Persistent data

Everything the app writes (paper trading positions, watchlist, alert signals, custom portfolio presets, notification history) lives in the `${STACK_NAME}_data` volume — the default name is `key-stock_data`, and it changes with `STACK_NAME`. Backup with:

```bash
STACK_NAME=${STACK_NAME:-key-stock}
docker run --rm \
  -v "${STACK_NAME}_data:/data" \
  -v "$PWD:/backup" \
  alpine tar czf "/backup/${STACK_NAME}-data-$(date +%F).tgz" -C /data .
```

Restore is the reverse — extract the tarball into a fresh volume, then start the stack.

### Health checks

Portainer surfaces the `ui` container as **healthy** when `GET /api/health` returns 200. This endpoint is intentionally lightweight — it doesn't open the database or call any upstream — so it stays green even if Yahoo / SEC are throttling. It is also whitelisted by the middleware so it works when `APP_TOKEN` is set. If the container stays **unhealthy**, check the container logs — the most common causes are:

- SEC blocking requests (change `SEC_USER_AGENT` to a real email).
- Yahoo Finance transient 429s (the app already backs off; wait 5 minutes).
- Native module compile failure on first build (make sure the host runs a recent Docker with buildx enabled).

### Logs

Portainer -> your stack -> click the container name -> **Logs**. Tail live with the "Auto-refresh" toggle. From the CLI:

```bash
docker logs -f key-stock-ui
docker logs -f key-stock-worker
```

### Resetting all data

Stop the stack, remove the volume, restart:

```bash
docker volume rm key-stock_data
```

The next boot re-creates an empty database with the seeded default watchlist row.
