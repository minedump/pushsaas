-- Статус доставки кодов входа — хранится в otp_requests и показывается в
-- «Журнал → Входы» (в «Рассылки» коды входа не попадают).
--   delivery_status: sent — провайдер принял, delivered — подтверждена доставка,
--                    failed — провайдер сообщил, что не доставлено.
--   delivery_detail: статус провайдера человеческим языком («Абонент недоступен»).
-- Старые строки остаются с null — для них статус неизвестен.
alter table public.otp_requests add column if not exists delivery_status text;
alter table public.otp_requests add column if not exists delivery_detail text;
alter table public.otp_requests add column if not exists delivery_updated_at timestamptz;

alter table public.otp_requests drop constraint if exists otp_requests_delivery_status_check;
alter table public.otp_requests add constraint otp_requests_delivery_status_check
  check (delivery_status is null or delivery_status in ('sent', 'delivered', 'failed'));
