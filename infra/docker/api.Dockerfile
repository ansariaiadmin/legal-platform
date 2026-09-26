FROM node:22-alpine AS builder

WORKDIR /app

# Copy every workspace manifest first so the dependency graph matches
# package-lock.json and `npm ci` can be used.
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/agents/civil-expert/package.json apps/agents/civil-expert/
COPY apps/agents/criminal-expert/package.json apps/agents/criminal-expert/
COPY apps/agents/family-expert/package.json apps/agents/family-expert/
COPY apps/agents/international-expert/package.json apps/agents/international-expert/
COPY apps/agents/legal-expert-base/package.json apps/agents/legal-expert-base/
COPY apps/agents/registration-expert/package.json apps/agents/registration-expert/
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# node-pg-migrate is a runtime dependency (migrations run inside this image),
# ts-node and typescript are needed to build, so dev dependencies are kept.
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/contracts packages/contracts
COPY packages/shared packages/shared
COPY apps/agents apps/agents
COPY apps/api apps/api

# Packages must be built before the API: it resolves their types from dist/.
RUN npm run build:packages && npm run build -w @legal-platform/api

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/agents ./apps/agents
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/src/database/migrations ./apps/api/src/database/migrations
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/package.json ./package.json

# Run as an unprivileged user (SPEC section 10: least privilege).
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/uploads /app/backups \
    && chown -R app:app /app
USER app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3001/api/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "apps/api/dist/main.js"]
