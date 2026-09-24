# Always-on TrueForge sidecar. TLS stays in front (Caddy or a Cloudflare tunnel).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/lib/trueforge ./src/lib/trueforge
ENV NODE_ENV=production
ENV HOME=/data
EXPOSE 8790
CMD ["npx", "tsx", "src/lib/trueforge/vm-server.ts"]
