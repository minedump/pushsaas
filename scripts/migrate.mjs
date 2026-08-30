import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Накат миграций. Работает и с облачным Supabase (TLS), и с локальным
 * Postgres в докере. После миграций сеет среду-специфичные настройки
 * расписания (app_config, см. migration 0090) из переменных окружения.
 */
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const conn = process.env.DATABASE_URL;
if (!conn) { console.error("DATABASE_URL required"); process.exit(1); }

// внутри докера база в приватной сети и ходит без TLS
const local = /@(db|localhost|127\.0\.0\.1)[:/]/.test(conn);
const opts = { connectionString: conn, ssl: local ? false : { rejectUnauthorized: false } };

// пароль берём из строки подключения: отдельной переменной у приложения нет,
// а служебным ролям нужен тот же самый, с которым поднялась база
const dbPassword = decodeURIComponent(new URL(conn).password) || process.env.POSTGRES_PASSWORD;

/**
 * Часть работы требует настоящего суперпользователя: служебные роли образа
 * защищены расширением supautils, и роль, под которой мы накатываем схему,
 * их менять не вправе — после установки её лишают суперправ.
 */
async function asAdmin(run) {
  const url = new URL(conn);
  url.username = "supabase_admin";
  const su = new pg.Client({ connectionString: url.toString(), ssl: false });
  await su.connect();
  try {
    return await run(su);
  } finally {
    await su.end().catch(() => {});
  }
}

/**
 * Если первый запуск базы оборвался на середине, роль postgres может так и
 * не появиться: скрипты образа, которые её создают, выполняются один раз за
 * жизнь тома и больше не повторятся. Заводим её сами — иначе контур чинится
 * только удалением тома с данными.
 */
async function createOwnRole() {
  const url = new URL(conn);
  const want = decodeURIComponent(url.username);
  await asAdmin(async (su) => {
    await su.query("select set_config('sendera.pw', $1, false)", [dbPassword]);
    await su.query(`do $$ declare pw text := current_setting('sendera.pw');
      begin execute format('create role ${want} superuser login password %L', pw); end $$;`);
    await su.query(`alter database ${url.pathname.slice(1)} owner to ${want}`);
    console.log(`роль ${want} восстановлена`);
  });
}

// в докере приложение стартует рядом с базой: она может быть ещё не готова.
// Клиент после неудачного подключения непригоден — создаём новый каждый раз.
let client;
let repaired = false;
for (let attempt = 1; ; attempt++) {
  client = new pg.Client(opts);
  try {
    await client.connect();
    break;
  } catch (e) {
    await client.end().catch(() => {});
    const roleMissing = /role .* does not exist/i.test(e?.message ?? "");
    if (local && roleMissing && !repaired) {
      repaired = true;
      try { await createOwnRole(); continue; } catch (sudoErr) {
        console.error("не удалось восстановить роль:", sudoErr.message);
      }
    }
    if (attempt >= 30) throw e;
    if (attempt === 1) console.log("жду готовности базы…");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// В докере служебные роли заводим сами: PostgREST ходит в базу как
// authenticator, файловое хранилище — как supabase_storage_admin, GoTrue —
// как supabase_auth_admin, и всем троим нужен тот же пароль, что у базы.
// Делаем это здесь, а не init-скриптом: те выполняются один раз за жизнь
// тома, а этот шаг — при каждом старте, поэтому неудачный первый запуск
// чинится следующим же деплоем.
if (local && dbPassword) {
  await asAdmin(async (su) => {
    await su.query("select set_config('sendera.pw', $1, false)", [dbPassword]);
    await su.query(`
      do $$
      declare pw text := current_setting('sendera.pw');
      begin
        if not exists (select from pg_roles where rolname = 'anon') then
          create role anon nologin noinherit; end if;
        if not exists (select from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin noinherit; end if;
        if not exists (select from pg_roles where rolname = 'service_role') then
          create role service_role nologin noinherit bypassrls; end if;
        if not exists (select from pg_roles where rolname = 'authenticator') then
          create role authenticator noinherit; end if;
        if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then
          create role supabase_storage_admin createrole; end if;
        if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
          create role supabase_auth_admin createrole; end if;
        execute format('alter role authenticator with login password %L', pw);
        execute format('alter role supabase_storage_admin with login password %L', pw);
        execute format('alter role supabase_auth_admin with login password %L', pw);
        execute 'grant anon, authenticated, service_role to authenticator';
      end $$;`);
    await su.query("create schema if not exists storage authorization supabase_storage_admin");
    // GoTrue сам создаёт свои таблицы внутри auth при первом старте — ему
    // достаточно владеть уже существующей схемой
    await su.query("create schema if not exists auth authorization supabase_auth_admin");
  });
  console.log("служебные роли готовы");
}

// Учёт уже применённых файлов: приложение накатывает миграции при КАЖДОМ
// старте контейнера (см. command в docker-compose.yml), а сами .sql-файлы
// писались для однократного применения (обычный create table/type без
// if not exists) — без этой таблицы второй и любой следующий деплой валится
// на "relation already exists" вместо запуска сервера.
await client.query(`create table if not exists public._migrations_applied (
  filename text primary key,
  applied_at timestamptz not null default now()
)`);
const { rows: appliedRows } = await client.query("select filename from public._migrations_applied");
const applied = new Set(appliedRows.map((r) => r.filename));

for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith(".sql")) continue;
  if (applied.has(f)) continue;
  console.log("applying", f);
  await client.query(readFileSync(resolve(dir, f), "utf8"));
  await client.query("insert into public._migrations_applied (filename) values ($1)", [f]);
}

// права выдаём после миграций, чтобы захватить только что созданные таблицы.
// Схема storage принадлежит не нам, поэтому раздаём права на неё от админа.
if (local && dbPassword) {
  await asAdmin((su) => su.query("grant all on schema storage to supabase_storage_admin, service_role"));
  await client.query(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
}

// Расписание (app_config, см. migration 0090): db-контейнер сидит в
// изолированной внутренней сети без выхода в интернет, поэтому pg_cron
// обязан звать приложение по внутреннему докер-адресу (http://app:3000),
// а не по публичному домену — тот снаружи, но недостижим изнутри backend-сети.
const seed = [
  ["base_url", process.env.INTERNAL_APP_URL || "http://app:3000"],
  ["cron_secret", process.env.CRON_SECRET],
].filter(([, v]) => v);
for (const [key, value] of seed) {
  await client.query(
    `insert into app_config (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  );
  console.log(`app_config: ${key} = ${key === "cron_secret" ? "***" : value}`);
}

const r = await client.query("select table_name from information_schema.tables where table_schema='public'");
console.log("tables:", r.rows.length);
await client.end();
