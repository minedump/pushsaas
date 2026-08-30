# Развёртывание

Приложение и всё его хозяйство — база, auth, файловое хранилище, доступ к
таблицам — поднимаются одной командой на обычном сервере с докером. Наружу
открыты только 80 и 443, остальное — во внутренней сети.

## Что нужно

- сервер: **2 ядра, 4 ГБ памяти, 40 ГБ диска SSD** — с запасом на рост.
  Расклад по потолкам сервисов в `docker-compose.yml`: db 2 ГБ + app 1.5 ГБ +
  auth/rest/storage/gateway ~0.7 ГБ суммарно — around 4.2 ГБ пиковых
  потолков (не одновременное использование, обычное потребление в разы
  меньше — два тестовых проекта займут от силы 400–600 МБ). При заметном
  росте числа проектов/подписчиков первое, что стоит поднять — память db и
  app (mem_limit/cpus в compose-файле), диск — под том Postgres и медиатеку.
- домен, направленный на адрес сервера
- Ubuntu; если докера нет, скрипт установки поставит его сам
- образ приложения уже собран на стороне GitHub (Settings → Secrets and
  variables → Actions — завести `NEXT_PUBLIC_SUPABASE_ANON_KEY` как secret,
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_APP_URL`/
  `NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID` как variables, см.
  `.github/workflows/docker-build.yml`) — сервер только скачивает готовый образ

## Установка

    mkdir -p /opt && git clone <репозиторий> /opt/sendera
    cp /opt/sendera/.env.docker.example /opt/sendera/.env
    nano /opt/sendera/.env          # заполнить значения
    bash /opt/sendera/scripts/install-vps.sh

Секреты — пароль базы, JWT-секрет, секрет cron-вызовов, секрет отписки:

    openssl rand -hex 32

Ключи доступа к таблицам/auth/хранилищу — это JWT, подписанные `JWT_SECRET`:

    node /opt/sendera/scripts/gen-keys.mjs "$JWT_SECRET"

VAPID-ключи для web push можно перенести с текущего облачного деплоя как
есть (значения уже лежат в `.env.local` разработческой машины) — смена
ключей отпишет всех текущих подписчиков заново подписываться. Либо
сгенерировать новые: `npm run gen:vapid`.

## Перенос данных с облачного Supabase

Первый запуск накатывает пустую схему (все `supabase/migrations/*.sql` по
порядку). Если нужно перенести уже накопленные данные с текущего облачного
проекта — выгрузить и загрузить обычным `pg_dump`/`psql` до первого включения
трафика на новый домен:

    pg_dump "$OLD_SUPABASE_DIRECT_URL" --data-only --schema=public \
      --exclude-table=schema_migrations > data.sql
    docker compose -f docker-compose.yml -f docker-compose.vps.yml \
      exec -T db psql -U postgres -d postgres < data.sql

Проверить построчно перед загрузкой — идентификаторы `auth.users` в дампе
не будет (auth не входит в `--schema=public`); владельцев проектов придётся
либо регистрировать заново на новом стенде, либо переносить `auth.users`
отдельно тем же способом (`--schema=auth`).

## Сертификат

Выпускается сам при первом обращении по домену и продлевается в фоне. Нужно,
чтобы домен указывал на сервер, а порты 80 и 443 были доступны снаружи — это
обычные требования Let's Encrypt.

## Обновление

Код приложения собирается на GitHub при пуше в `main` — на сервере нужно
только забрать новый образ:

    cd /opt/sendera && git pull
    docker compose -f docker-compose.yml -f docker-compose.vps.yml pull app
    docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d

`git pull` нужен, только если менялись сами compose-файлы, `docker/*` или
`supabase/migrations/*` — миграции накатываются автоматически при каждом
старте контейнера `app` (см. `command:` в `docker-compose.yml`), новые файлы
просто добавляются к уже применённым.

Приложение недоступно секунд десять-пятнадцать, пока новый контейнер
поднимается и накатывает миграции (если они есть).

## Резервные копии

Данные лежат в двух томах: `sendera_db-data` (база) и `sendera_storage-data`
(медиатека, иконки PWA-манифеста). Ежедневная копия базы:

    cd /opt/sendera && docker compose -f docker-compose.yml -f docker-compose.vps.yml \
      exec -T db pg_dump -U postgres postgres | gzip > backup-$(date +%F).sql.gz

Восстановление:

    gunzip -c backup-2026-08-30.sql.gz | docker compose -f docker-compose.yml \
      -f docker-compose.vps.yml exec -T db psql -U postgres postgres

Проверяйте восстановление на отдельной машине — копия, которую ни разу не
разворачивали, копией не считается. Файловое хранилище (`storage-data`) —
обычный каталог на диске, бэкапится как файлы (`tar`/rsync на другой сервер).

## Проверка после запуска

    cd /opt/sendera
    docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
    docker compose -f docker-compose.yml -f docker-compose.vps.yml logs app --tail 30
    docker compose -f docker-compose.yml -f docker-compose.vps.yml exec -T db \
      psql -U postgres -c "select jobname, schedule from cron.job"

Расписание должно содержать пять заданий: `send-scheduled-campaigns` и
`run-recurring` раз в 5 минут, `run-campaign-jobs`/`run-automations`
ежеминутно, `refresh-product-feeds` раз в 15 минут.

Отдельно проверить вход: открыть `https://<домен>/login`, зарегистрировать
владельца — письмо не потребуется, self-hosted auth настроен на
автоподтверждение почты (`GOTRUE_MAILER_AUTOCONFIRM`, тот же режим, что
сейчас на облачном Supabase-проекте).

## Отладка на своей машине

    docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

Приложение поднимется на `http://localhost:3001` (порт 3000 может быть занят
другим локальным стендом — см. комментарий в `docker-compose.local.yml`) без
домена и сертификата (здесь `app` собирается из исходников на месте — образ
из ghcr.io не используется, `APP_IMAGE`/`GHCR_*` можно не заполнять в `.env`;
`APP_BASE_URL` в `.env` должен быть `http://localhost:3001`).

## Что не перенесено из этого захода

- **Продление тарифа** (`/api/cron/renew`) по-прежнему не поставлено на
  внутренний pg_cron — при переезде на self-hosted стенд его тоже стоит
  завести миграцией по образцу 0031/0057/0058/0063/0085 (сейчас он
  рассчитан на внешний cron, который отдельно не настраивался).
- SMTP не настроен (регистрация работает без подтверждения почты — см. выше);
  если понадобится сброс пароля по почте или реальная верификация e-mail,
  GoTrue нужно донастроить `GOTRUE_SMTP_*` и выключить `MAILER_AUTOCONFIRM`.
