# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Optional SBOM validator deps are not required inside the app image build.
RUN npm install --omit=optional

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY sql ./sql
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime image keeps production deps aligned to the lockfile without pulling dev-only SBOM tooling.
RUN npm install --omit=dev --omit=optional && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/sql ./sql
COPY scripts/container-healthcheck.mjs ./scripts/container-healthcheck.mjs
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "scripts/container-healthcheck.mjs"]
CMD ["node", "dist/index.js"]