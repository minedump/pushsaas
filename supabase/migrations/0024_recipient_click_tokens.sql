-- Персональный трекинг клика по SMS/Email: у каждого получателя свой
-- непрозрачный token (без PII в ссылке), кладётся в ?pss_r=... рядом с
-- ?pss_c=... — embed-скрипт на сайте клиента (app/embed/[projectId]/route.ts)
-- шлёт его вместе с кликом, /api/public/track проставляет clicked_at именно
-- этой строке. Push не нуждается в token — там получатель уже известен
-- напрямую (contact = subscriber_id, приходит от сервис-воркера).
alter table public.campaign_recipients add column if not exists token text;
alter table public.campaign_recipients add column if not exists clicked_at timestamptz;
create unique index if not exists idx_campaign_recipients_token on public.campaign_recipients(token) where token is not null;
