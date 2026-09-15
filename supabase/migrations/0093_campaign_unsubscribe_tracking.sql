-- Отписки по ссылке в письме — тот же принцип, что открытия/клики (0024/0036):
-- unsubscribed_at на campaign_recipients (первая отписка побеждает), агрегат
-- unsubscribed_count на campaigns. Ссылка отписки (lib/unsubscribe.ts) сама по
-- себе несёт только project+email — привязку к конкретной отправке даёт
-- injectClickTracking (lib/sender.ts), который дописывает ?pss_c=&pss_r= на
-- КАЖДУЮ https-ссылку в письме, включая unsubscribe_url — эти параметры уже
-- были на проводе, просто раньше нигде не читались (см. app/api/public/unsubscribe).
alter table public.campaign_recipients add column if not exists unsubscribed_at timestamptz;
alter table public.campaigns add column if not exists unsubscribed_count integer not null default 0;

create or replace function public.increment_campaign_unsubscribed(p_campaign_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.campaigns set unsubscribed_count = unsubscribed_count + 1 where id = p_campaign_id;
$$;
