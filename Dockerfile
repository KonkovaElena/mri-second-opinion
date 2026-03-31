# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY sql ./sql
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
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