# Client portal (apps/client), served by nginx under /portal.
FROM node:22-alpine AS builder

WORKDIR /app

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

RUN npm ci

COPY tsconfig.base.json ./
COPY apps/client apps/client

# The portal has no internal package dependencies, so only it is built.
RUN npm run build -w @legal-platform/client

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/apps/client/.next/standalone ./
COPY --from=builder /app/apps/client/.next/static ./apps/client/.next/static
COPY --from=builder /app/apps/client/public ./apps/client/public

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3100

CMD ["node", "apps/client/server.js"]
