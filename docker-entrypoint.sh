#!/bin/sh
# =============================================================================
# Container entrypoint.
#
# Runs as root, then drops to an arbitrary PUID/PGID before exec-ing the
# real CMD. This is the LinuxServer.io-style "match host uid/gid" pattern
# — it lets bind-mounted host directories be owned by the deploying user
# (e.g. `1000:1000` on Ubuntu, `501:20` on macOS) without a manual chown
# dance on every fresh volume.
#
# Design notes:
#
#   * We accept numeric UID/GID directly (su-exec supports this), so there
#     is NO usermod / groupmod step. That's important because our compose
#     files set `read_only: true` — /etc/passwd cannot be written to
#     anyway. Node.js does not need a matching passwd row to run.
#
#   * We only chown /app/data. Everything else on the root filesystem is
#     either read-only (baked into the image) or a tmpfs (`/tmp`), and
#     the container's process only ever writes to /app/data.
#
#   * chown failures are downgraded to a warning. Some bind mounts (NFS
#     with root_squash, ZFS with restricted xattrs) will reject chown
#     from inside the container even when running as root; in that case
#     the operator has to prepare the host directory themselves and the
#     warning explains what to check.
# =============================================================================

set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ -d /app/data ]; then
  if ! chown -R "${PUID}:${PGID}" /app/data 2>/dev/null; then
    echo "[entrypoint] warn: chown -R ${PUID}:${PGID} /app/data failed —" \
         "check bind-mount permissions on the host (chown the directory" \
         "manually to ${PUID}:${PGID} if the mount is read-only for root)."
  fi
fi

# Point HOME at a writable path in case a downstream library dereferences
# it (npm, node's os.homedir(), etc.). /tmp is a tmpfs in our compose
# files so writes are ephemeral by design.
export HOME="${HOME:-/tmp}"

# su-exec is a lightweight ~10 KB C replacement for gosu — it uses
# setuid() + execve() so no privilege escalation happens (compatible
# with `security_opt: no-new-privileges:true`).
exec su-exec "${PUID}:${PGID}" "$@"
