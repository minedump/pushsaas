# syntax=docker/dockerfile:1
# PushSaaS — Next.js 15, multi-stage build → минимальный рантайм-образ.
# Debian slim (не Alpine): sharp/vips на musl иногда капризничает, здесь не рискуем.

# Пин по digest, не по мутабельному тегу (security-аудит 2026-09-01) —
# node:20-bookworm-slim, свежий на момент фикса. Обновлять сознательно:
# docker pull node:20-bookworm-slim && docker inspect --format='{{index .RepoDigests 0}}' node:20-bookworm-slim
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS base

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

# Миграции и скрипт их наката (scripts/migrate.mjs, см. docker-compose.yml —
# self-hosted стенд накатывает их перед стартом). Скрипт живёт вне сборки
# Next, поэтому в автономный сервер его зависимости не попадают сами —
# берём драйвер Postgres из стадии, где зависимости уже установлены.
# На боевой деплой (TimeWeb, без docker-compose) это не влияет: команда
# запуска образа по умолчанию (CMD ниже) миграции не вызывает.
COPY --from=builder --chown=nextjs:nodejs /app/supabase ./supabase
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg ./node_modules/pg
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg-cloudflare ./node_modules/pg-cloudflare
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/split2 ./node_modules/split2
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/xtend ./node_modules/xtend

USER nextjs
EXPOSE 3000

# Серверные переменные (Supabase service role, VAPID, CloudPayments secret,
# CRON_SECRET и т.д.) передавайте через `docker run -e ...` / compose env —
# в образ не запекаются.
#
# По умолчанию миграции НЕ накатываются (боевой деплой на TimeWeb не задаёт
# DATABASE_URL и использует облачный Supabase, миграции на который накатывают
# отдельно) — self-hosted docker-compose.yml переопределяет command сам.
CMD ["node", "server.js"]
