# Deprecated. Production is Vercel plus the Contabo sidecar, not this image.
# Kept so an old Railway checkout still builds. Node matches the repo engines field.

FROM node:22.14.0-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
