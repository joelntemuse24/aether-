#!/command/with-contenv sh
# Runs as s6 cont-init *before* 02-reconcile-profiles starts the
# supervised gateway. Railway healthchecks and public domains use PORT;
# Hermes reads API_SERVER_PORT. Writing the s6 env dir makes the mapped
# port visible to later with-contenv services.
#
# On non-PID-1 runtimes the dispatcher skips s6; railway-cmd.sh maps PORT.
set -eu

if [ -n "${PORT:-}" ]; then
  for d in /var/run/s6/container_environment /run/s6/container_environment; do
    if [ -d "$d" ]; then
      printf '%s' "$PORT" > "$d/API_SERVER_PORT"
    fi
  done
fi
