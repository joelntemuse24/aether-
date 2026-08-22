#!/command/with-contenv sh
# Install the Aether tools plugin into HERMES_HOME so the host can call
# back to Aether. Does not rewrite an existing config.yaml.
set -eu

HOME_DIR="${HERMES_HOME:-/opt/data}"
SRC="/opt/aether/plugins/aether-tools"
DEST="${HOME_DIR}/plugins/aether-tools"

if [ -d "$SRC" ]; then
  mkdir -p "${HOME_DIR}/plugins"
  cp -a "$SRC" "$DEST"
fi
