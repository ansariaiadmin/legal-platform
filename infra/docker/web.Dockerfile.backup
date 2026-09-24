FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/contracts packages/contracts
COPY packages/shared packages/shared
COPY apps/web apps/web

RUN npm run build:packages && npm run build -w @legal-platform/web

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
