import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import CopyBox from "../CopyBox";
import ApiKeys from "./ApiKeys";

export default async function ApiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, domain, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // Какие провайдеры sms/email реально настроены (ключи в «Подключениях») —
  // из них можно выбирать при создании API-ключа. best-effort: отсутствие
  // haskimail_marketing_stream (миграция 0020) не должно ронять bytehand/smsc.
  // Haskimail — один токен на аккаунт, нужен и токен, и ID рассылочного
  // канала (MessageStream), иначе письмо уйдёт в дефолтный транзакционный.
  const admin = createAdminClient();
  const { data: secrets } = await admin
    .from("project_secrets")
    .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token")
    .eq("project_id", id)
    .maybeSingle();
  const { data: streamSecret, error: streamErr } = await admin
    .from("project_secrets")
    .select("haskimail_marketing_stream")
    .eq("project_id", id)
    .maybeSingle();
  const smscReady = !!secrets?.smsc_login && !!secrets?.smsc_password;
  const haskimailReady = !!secrets?.haskimail_server_token && !streamErr && !!streamSecret?.haskimail_marketing_stream;
  const providerOptions = {
    sms: [
      ...(secrets?.bytehand_service_key ? [{ value: "bytehand", label: "Bytehand" }] : []),
      ...(smscReady ? [{ value: "smsc", label: "SMSC.ru" }] : []),
    ],
    email: [
      ...(haskimailReady ? [{ value: "haskimail", label: "Haskimail" }] : []),
      ...(smscReady ? [{ value: "smsc", label: "SMSC.ru" }] : []),
    ],
  };

  // best-effort: sms_provider/email_provider — колонки миграции 0019,
  // отсутствие не должно ронять список ключей.
  const { data: keysFull, error: keysErr } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, is_active, last_used_at, created_at, sms_provider, email_provider")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const { data: keysBasic } = keysErr
    ? await supabase
        .from("api_keys")
        .select("id, name, key_prefix, is_active, last_used_at, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
    : { data: null };
  const keys = keysFull ?? keysBasic;

  const app = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">API</h1>
      <p className="text-ink-muted mt-0">Отправляйте пуши, SMS и email из своего кода или CRM.</p>

      <ApiKeys projectId={id} initial={keys ?? []} providerOptions={providerOptions} />

      <h2 className="text-base font-semibold mt-9">Вебхуки (универсальный триггер)</h2>
      <p className="text-ink-muted text-[13px] mt-1">
        Один эндпоинт <code className="font-mono">/api/v1/trigger</code> для любых платформ. Ключ — в URL (<code className="font-mono">?key=</code>) или
        прямо в ссылке (<code className="font-mono">https://wpk_КЛЮЧ@host/…</code>). Пути к телефону, статусу и номеру заказа
        задаются в самой автоматизации (раздел <b>Автоматизации → Транзакционные</b>), поэтому ссылки короткие.
        Любое поле заказа доступно как <code className="font-mono">{"{поле}"}</code>, в т.ч. вложенное <code className="font-mono">{"{client.name}"}</code>.
      </p>

      <div className="mt-3 text-[13px] font-semibold">Новый заказ → «Спасибо за заказ»</div>
      <CopyBox text={`${app}/api/v1/trigger?key=wpk_ВАШ_КЛЮЧ&automation=new_order`} />

      <div className="mt-4 text-[13px] font-semibold">Смена статуса → трек-номер</div>
      <CopyBox text={`${app}/api/v1/trigger?key=wpk_ВАШ_КЛЮЧ&automation=order_shipped`} />
      <p className="text-ink-faint text-[12px]">
        Статус, телефон и дедуп — из настроек автоматизации <code className="font-mono">order_shipped</code>.{" "}
        Трек-номер и любые поля заказа подставляйте <b>прямо в текст</b> по их пути из тела вебхука:{" "}
        <code className="font-mono">{"{delivery.tracking_number}"}</code> или из массива{" "}
        <code className="font-mono">{"{fields[name=Трек-номер].value}"}</code> — <code className="font-mono">map</code> больше не нужен.
      </p>

      <div className="mt-4 text-[13px] font-semibold">Массовая рассылка (не транзакционная)</div>
      <CopyBox text={`${app}/api/v1/trigger?key=wpk_ВАШ_КЛЮЧ&automation=flash_sale`} />
      <p className="text-ink-faint text-[12px]">
        Автоматизация без телефона шлёт всем. Сегмент — из тела по пути (задаётся в автоматизации), либо
        <code className="font-mono">?segment=vip</code>. Если в теле окажется телефон — уйдёт точечно клиенту.
      </p>

      <p className="text-ink-faint text-[12px] mt-4">
        Атрибуция заказов к пушам — в разделе{" "}
        <a href={`/admin/projects/${id}/settings`} className="text-accent">
          Настройки
        </a>
        , у неё свой отдельный вебхук-токен.
      </p>

      <h2 className="text-base font-semibold mt-9">Эндпоинты</h2>
      <pre className="bg-surface-2 border border-border rounded-xl p-4 text-[12.5px] overflow-x-auto font-mono leading-relaxed">
{`# Отправить пуш всем (или сегменту)
curl -X POST ${app}/api/v1/send \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Привет","body":"Тест","url":"https://site.ru","segmentTags":["vip"]}'

# Отправить пуш по номеру телефона (устройства, привязанные через вход по телефону)
curl -X POST ${app}/api/v1/send \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Ваш заказ отправлен","body":"Трек-номер внутри","phones":["+79991234567"]}'

# Отправить пуш по email (только тем, у кого email уже известен — попадает
# в базу автоматически из транзакционных вебхуков заказа)
curl -X POST ${app}/api/v1/send \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Специально для вас","body":"...","emails":["client@example.com"]}'

# Отправить SMS (провайдер закреплён за ключом — см. настройку выше)
curl -X POST ${app}/api/v1/send \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"sms","text":"Скидка 20% сегодня","phones":["+79991234567"]}'

# Отправить письмо по шаблону (id — из GET /api/v1/templates)
curl -X POST ${app}/api/v1/send \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"email","templateId":"ШАБЛОН_ID","emails":["client@example.com"]}'

# ...или со своим HTML вместо шаблона
curl -X POST ${app}/api/v1/send \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"email","subject":"Скидка недели","html":"<p>Привет!</p>","segmentTags":["vip"]}'

# Шаблоны есть и для push/SMS (раздел «Шаблоны» → канал Push/SMS) — тот же
# templateId, что и у email; в шаблоне доступен полноценный Liquid ({{ key }},
# {% if %}, фильтры), данные — из templateData
curl -X POST ${app}/api/v1/send \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"templateId":"ШАБЛОН_ID","templateData":{"percent":"20"},"phones":["+79991234567"]}'

# Список шаблонов проекта (id пригодится для templateId выше);
# необязательный ?channel=push|sms|email фильтрует по каналу
curl ${app}/api/v1/templates \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ"

# Запустить триггерную автоматизацию по ключу
curl -X POST ${app}/api/v1/trigger \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"key":"abandoned_cart","segmentTags":["cart"]}'

# Статистика по подписчикам
curl ${app}/api/v1/subscribers \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ"

# Создать/отредактировать контакт и включить рассылку по каналу — вход по
# коду (*_verified_at) сам по себе НЕ включает SMS/Email для рассылок,
# только для входа; smsActive/emailActive — единственный способ дать
# согласие (false — отписать обратно)
curl -X POST ${app}/api/v1/contacts \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"+79991234567","name":"Иван","smsActive":true,"emailActive":true}'`}
      </pre>
    </main>
  );
}
