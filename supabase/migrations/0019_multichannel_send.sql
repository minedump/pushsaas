-- =====================================================================
--  0019 — SMS/Email как полноценные каналы отправки (кампании + API), не
--  только доставка OTP-кода. Провайдеры не меняются — Bytehand/SMSC уже
--  умеют слать произвольный text (см. lib/otp/sms.ts, lib/otp/smsc.ts),
--  задействуем их напрямую для рассылок. Telegram Gateway остаётся только
--  для авторизации — это OTP-only API по своей природе (Telegram сам так
--  спроектировал Gateway), для рассылок не подходит.
--
--  Haskimail требует ОТДЕЛЬНЫЙ токен под канал рассылок — это ограничение
--  самого Haskimail (транзакционный и marketing-трафик разносятся на их
--  стороне), не наше решение. Существующий haskimail_server_token остаётся
--  токеном для входа (OTP), новый haskimail_broadcast_token — для кампаний.
-- =====================================================================

-- Свои HTML-шаблоны писем на проект — раздел «Шаблоны» в админке, доступны
-- при отправке email-кампаний (в UI и через /api/v1/send).
create table public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name       text not null,
  subject    text,
  html       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_email_templates_project on public.email_templates(project_id);

alter table public.project_secrets add column if not exists haskimail_broadcast_token text;

-- Провайдер на канал закрепляется за КЛЮЧОМ при его создании (не выбирается
-- в каждом запросе) — так один проект может держать разные ключи под разные
-- send-провайдеры, если понадобится. Канал (push/sms/email) в отличие от
-- этого выбирается в теле каждого запроса.
alter table public.api_keys add column if not exists sms_provider text;
alter table public.api_keys add column if not exists email_provider text;

-- campaigns: канал-дискриминатор + контент под email. push-колонки
-- (icon_url/image_url/click_url/actions) для sms/email остаются null.
alter table public.campaigns add column if not exists channel text not null default 'push'
  check (channel in ('push', 'sms', 'email'));
alter table public.campaigns add column if not exists subject text;
alter table public.campaigns add column if not exists html_body text;
alter table public.campaigns add column if not exists template_id uuid references public.email_templates(id) on delete set null;
alter table public.campaigns add column if not exists provider text;
-- rich push badge — поле уже читает service-worker (public/sdk/service-worker.js),
-- но раньше было нечем его заполнить ни на одном уровне (кампании/API).
alter table public.campaigns add column if not exists badge_url text;

alter table public.email_templates enable row level security;
create policy email_templates_rw on public.email_templates
  for all using (
    exists (select 1 from public.projects p
            where p.id = email_templates.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  ) with check (
    exists (select 1 from public.projects p
            where p.id = email_templates.project_id
              and (p.owner_id = auth.uid() or public.is_admin()))
  );
