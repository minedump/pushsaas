-- Открытия email — тот же принцип, что и клик-трекинг (миграции 0023/0024):
-- пиксель 1x1 в письме, персональный token уже есть (campaign_recipients.token,
-- переиспользуем — не заводим отдельный). opened_at — первое открытие
-- побеждает, opened_count на campaigns — агрегат для быстрого отображения,
-- как sent_count/delivered_count/clicked_count.
alter table public.campaign_recipients add column if not exists opened_at timestamptz;
alter table public.campaigns add column if not exists opened_count integer not null default 0;

-- Атомарный инкремент — /api/public/open вызывается конкурентно (несколько
-- получателей открывают письмо одновременно), обычный select+update гонялся
-- бы за собственным хвостом под нагрузкой. Тот же паттерн, что у
-- spend_pushes/refund_pushes.
create or replace function public.increment_campaign_opened(p_campaign_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.campaigns set opened_count = opened_count + 1 where id = p_campaign_id;
$$;
