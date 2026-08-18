FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/web/package*.json ./apps/web/

RUN npm install

COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public
COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/next.config.js ./apps/web/
COPY tsconfig.base.json ./

WORKDIR /app/apps/web
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public

ENV NODE_ENV=production

CMD ["node", "server.js"]
