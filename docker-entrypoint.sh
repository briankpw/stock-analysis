#!/bin/sh
# =============================================================================
# Container entrypoint.
#
# Two supported startup modes:
#
#   1) Container starts NON-ROOT (compose has `user: "${PUID}:${PGID}"`).
#      We just export HOME and exec the CMD. This is the hardened mode —
#      compatible with `cap_drop: [ALL]` and `no-new-privileges:true`
#      because neither chown() nor setgroups() are ever called.
#      Requires the host to have chowned the bind mount to PUID:PGID
#      before start; on named volumes Docker creates it root-owned so
#      an initial `docker exec ... chown` may be needed the first time.
#
#   2) Container starts as ROOT (no `user:` in compose, or `--user 0:0`
#      on `docker run`). We chown /app/data to PUID:PGID and su-exec
#      down. This is the LinuxServer.io-style path and requires
#      CAP_CHOWN + CAP_SETGID + CAP_SETUID to be present in the
#      container — DO NOT combine it with `cap_drop: [ALL]`.
#
# The dual-mode design means the same image works both for the hardened
# production compose stack (mode 1) and for a plain `docker run` on a
# dev laptop (mode 2), without maintaining two images.
# =============================================================================

set -eu

# Point HOME at a writable path in case a downstream library dereferences
# it (npm, node's os.homedir(), etc.). /tmp is a tmpfs in our compose
# files so writes are ephemeral by design.
export HOME="${HOME:-/tmp}"

CURRENT_UID="$(id -u)"

if [ "${CURRENT_UID}" != "0" ]; then
  # Mode 1 — already non-root. We can't chown anything (no CAP_CHOWN
  # in the hardened profile), so trust that the operator has prepared
  # /app/data with the correct ownership. Everything else on the root
  # filesystem is read-only or a tmpfs, so no other writable paths
  # need setup.
  if [ -d /app/data ] && [ ! -w /app/data ]; then
    echo "[entrypoint] warn: /app/data is not writable by uid ${CURRENT_UID}." \
         "chown it on the host to match the container's runtime uid," \
         "or drop the compose 'user:' override to use the root+su-exec path."
  fi
  exec "$@"
fi

# Mode 2 — we're root; do the LinuxServer.io dance.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ -d /app/data ]; then
  if ! chown -R "${PUID}:${PGID}" /app/data 2>/dev/null; then
    echo "[entrypoint] warn: chown -R ${PUID}:${PGID} /app/data failed —" \
         "check bind-mount permissions on the host (chown the directory" \
         "manually to ${PUID}:${PGID} if the mount is read-only for root)."
  fi
fi

# su-exec is a lightweight ~10 KB C replacement for gosu — it uses
# setgroups() + setgid() + setuid() + execve(), which requires
# CAP_SETGID + CAP_SETUID in the container's capability set. If those
# were dropped (e.g. `cap_drop: [ALL]` without the corresponding
# `cap_add`) the setgroups() call fails with EPERM. Fix: run the
# container with `user: "PUID:PGID"` so we take the non-root path above
# and never need those capabilities.
exec su-exec "${PUID}:${PGID}" "$@"
