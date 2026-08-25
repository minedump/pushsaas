-- Оплаченные заказы отдельно от факта атрибуции: "оборот" (revenue,
-- attribution_revenue_path) — по любому заказу с кукой рассылки, а "оплачено"
-- — подмножество, где реально прошла оплата, суммой БЕЗ доставки, но С учётом
-- скидок. Поля InSales для статуса оплаты/суммы без доставки не подтверждены
-- реальным заказом (в отличие от number/total_price, см. /api/v1/attribute),
-- поэтому — как и остальные webhook-пути в проекте — настраиваемые, мерчант
-- заполняет их сам по своему реальному телу вебхука.
alter table public.projects add column if not exists attribution_paid_path text;
alter table public.projects add column if not exists attribution_paid_value text not null default 'paid';
alter table public.projects add column if not exists attribution_paid_amount_path text;

alter table public.order_attributions add column if not exists is_paid boolean not null default false;
alter table public.order_attributions add column if not exists paid_amount numeric(12,2);
