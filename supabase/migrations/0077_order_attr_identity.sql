-- Заказ должен быть виден на карточке КОНТАКТА (identity), а не только у
-- push-устройства — покупатель мог оформить заказ, ни разу не подписавшись
-- на push (см. миграцию 0071, push-optional). subscriber_id остаётся для
-- обратной совместимости там, где устройство реально есть, но карточка
-- подписчика (SubscriberProfile) теперь читает по identity_id.
alter table public.order_attributions add column if not exists identity_id uuid references public.identities(id) on delete set null;
create index if not exists idx_order_attr_identity on public.order_attributions(identity_id);
