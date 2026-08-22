#!/bin/sh
# Official invocation is `hermes gateway run` (same as
# `docker run nousresearch/hermes-agent gateway run`).
#
# Railway injects PORT for public routing and healthchecks.
# Hermes listens on API_SERVER_PORT (default 8642). Map PORT onto
# the API server here so we do not replace the image ENTRYPOINT.
# Official ENTRYPOINT (entrypoint-dispatch.sh) still runs first:
#   PID 1 → s6 /init → main-wrapper → this script
#   wrapped PID 1 (Fly / some schedulers) → stage2 + main-wrapper → this script
set -eu

export API_SERVER_ENABLED="${API_SERVER_ENABLED:-true}"
export API_SERVER_HOST="${API_SERVER_HOST:-0.0.0.0}"

if [ -n "${PORT:-}" ]; then
  export API_SERVER_PORT="$PORT"
else
  export API_SERVER_PORT="${API_SERVER_PORT:-8642}"
fi

exec hermes gateway run
