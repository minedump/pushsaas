-- Отвязываем "устройство знает нас" от "устройство подписано на push":
-- subscribers.endpoint/p256dh/auth были not null — строка subscribers
-- физически не могла существовать без реальной push-подписки браузера, а
-- значит и identity_devices (которая ссылается на subscribers.id) не могла
-- знать про браузер, пока он не дал разрешение на push — трекинг событий,
-- обогащение (sendera.identify), OTP-привязка устройства при входе — всё
-- было на паузе до push, даже если человек уже реально авторизовался и
-- обогатил устройство своими данными и цель отправки — email/SMS, push вообще
-- не нужен.
--
-- Теперь subscribers может быть "анонимным устройством" (endpoint/p256dh/auth
-- = null, но device_token_hash есть) — заводится через новый
-- /api/public/register-device (см.), НЕ через /api/public/subscribe (та
-- по-прежнему требует настоящую PushSubscription). Резолв по
-- device_token_hash уже существовал (см. /api/public/link,
-- /api/public/recognize) — теперь просто есть что резолвить и без push.
--
-- Везде, где subscribers реально идёт в отправку push (sendPush), нужен
-- добавленный фильтр "endpoint is not null" — эта миграция сама по себе
-- НЕ добавляет такие фильтры, это сделано отдельно в коде (см. lib/sender.ts
-- и соответствующий аудит вызовов).
alter table public.subscribers alter column endpoint drop not null;
alter table public.subscribers alter column p256dh drop not null;
alter table public.subscribers alter column auth drop not null;
