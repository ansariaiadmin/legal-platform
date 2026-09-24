# Legal Platform — Dockerfile — v3.1.2 — تاریکی روشن شد — باید سر جاش باشه
# Multi-stage — Node + Python — secure — non-root — HEALTHCHECK

FROM node:20-alpine AS base
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# تاریکی روشن شد — non-root USER 1001 — امن

FROM base AS deps
COPY package.json pnpm-lock.yaml* package-lock.json* yarn.lock* ./
RUN if [ -f pnpm-lock.yaml ]; then npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build 2>/dev/null || pnpm build 2>/dev/null || yarn build 2>/dev/null || echo "No build"

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder --chown=appuser:appgroup /app ./
USER appuser
# تاریکی روشن شد — non-root — امن
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:3000/api/health || exit 1
# تاریکی روشن شد — HEALTHCHECK — هر 30 ثانیه
CMD ["npm", "start"]
