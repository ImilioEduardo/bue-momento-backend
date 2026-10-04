# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm prisma generate

COPY . .
RUN pnpm build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy Prisma schema + generated client from builder
COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy compiled application
COPY --from=builder /app/dist ./dist

# Copy start helper
COPY scripts ./scripts
RUN chmod +x ./scripts/start.sh

# SERVICE=api (default) runs migrations + API server
# SERVICE=worker runs the BullMQ worker process
ENV SERVICE=api
CMD ["sh", "./scripts/start.sh"]
