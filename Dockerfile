# syntax=docker/dockerfile:1
# PushSaaS — Next.js 15, multi-stage build → минимальный рантайм-образ.
# Debian slim (не Alpine): sharp/vips на musl иногда капризничает, здесь не рискуем.

FROM node:20-bookworm-slim AS base

# ---------------------------------------------------------------------
# deps — устанавливаем зависимости отдельным слоем (кэшируется, пока не
# меняется package-lock.json)
# ---------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------
# builder — собираем приложение
# ---------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* вшиваются в клиентский бандл на этапе сборки — их нужно
# передать через --build-arg, значений из runtime .env для них недостаточно.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID=$NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------------
# runner — только то, что нужно для запуска (output: "standalone")
# ---------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Серверные переменные (Supabase service role, VAPID, CloudPayments secret,
# CRON_SECRET и т.д.) передавайте через `docker run -e ...` / compose env —
# в образ не запекаются.
CMD ["node", "server.js"]
