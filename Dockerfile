# Aether Railway host — thin derived image, not a Hermes fork.
#
# Verified 2026-08-22 against:
#   https://hermes-agent.nousresearch.com/docs/user-guide/docker
#   https://github.com/NousResearch/hermes-agent/blob/main/Dockerfile
#
# Official image contracts we must not break:
#   ENTRYPOINT ["/opt/hermes/docker/entrypoint-dispatch.sh"]
#     PID 1 → s6 /init (supervision). Wrapped PID 1 → stage2 + main-wrapper.
#   Official CMD is empty; documented run is `gateway run`.
#   Data volume: /opt/data (HERMES_HOME).
#   API listen: API_SERVER_ENABLED + API_SERVER_HOST + API_SERVER_PORT (8642)
#     + API_SERVER_KEY (min 8 chars; image startup guard is 16).
#   Do not set HERMES_DASHBOARD=1 (public dashboard is out of scope).
#   Do not set a Railway startCommand — it replaces ENTRYPOINT and breaks s6.
#
# Keep /Dockerfile and deploy/hermes/Dockerfile identical.
# Build context is the repository root.
# Vercel project `aether` must stay on the Next.js builder — do not switch it to Docker.

FROM nousresearch/hermes-agent:latest

# stage2 seed_one copies $INSTALL_DIR/cli-config.yaml.example →
# $HERMES_HOME/config.yaml only when missing. Overlay the official example
# so first boot gets Aether settings; live volumes are left alone.
COPY deploy/hermes/seed/config.yaml /opt/aether/seed/config.yaml
COPY deploy/hermes/seed/config.yaml /opt/hermes/cli-config.yaml.example
COPY --chmod=0755 deploy/hermes/railway-cmd.sh /opt/aether/railway-cmd.sh
COPY --chmod=0755 deploy/hermes/00-aether-port.sh /etc/cont-init.d/00-aether-port

# HERMES_DASHBOARD unset/0 = dashboard service stays down (official Docker docs).
# HERMES_GATEWAY_BOOTSTRAP_STATE=running seeds gateway_state.json on a blank
# volume so s6 auto-starts the default gateway (official env; first-boot only).
ENV HERMES_DASHBOARD=0 \
    HERMES_GATEWAY_BOOTSTRAP_STATE=running \
    API_SERVER_ENABLED=true \
    API_SERVER_HOST=0.0.0.0

# Documented default. Railway injects PORT at runtime; railway-cmd.sh and
# 00-aether-port.sh set API_SERVER_PORT=${PORT:-8642}.
EXPOSE 8642

# Equivalent official invocation (`gateway run`) after mapping Railway PORT.
# Do not set USER — s6 /init must start as root, then drop to hermes.
CMD ["/opt/aether/railway-cmd.sh"]
