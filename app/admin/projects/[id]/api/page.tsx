import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import CopyBox from "../CopyBox";
import ApiKeys from "./ApiKeys";
import AttributionSettings from "./AttributionSettings";

export default async function ApiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, domain, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // best-effort: настройки атрибуции — отдельный запрос, отсутствие колонок
  // (до миграции 0009) не роняет страницу.
  const { data: attrRow, error: attrErr } = await supabase
    .from("projects")
    .select("attribution_enabled, attribution_cookie_name, attribution_window_days")
    .eq("id", id)
    .maybeSingle();
  const attribution = {
    enabled: !attrErr && !!attrRow?.attribution_enabled,
    cookieName: attrRow?.attribution_cookie_name || "pss_attr",
    windowDays: attrRow?.attribution_window_days || 7,
  };

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, is_active, last_used_at, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const app = process.env.NEXT_PUBLIC_APP_URL || "";

  return (
    <main className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">{project.name} · API</h1>
      <p className="text-ink-muted mt-0">Отправляйте пуши из своего кода или CRM.</p>

      <ApiKeys projectId={id} initial={keys ?? []} />

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

      <h2 className="text-base font-semibold mt-9">Атрибуция заказов к пушам</h2>
      <p className="text-ink-muted text-[13px] mt-1">
        Модель — последний клик: наш скрипт ставит покупателю куку по клику на пуш, InSales сохраняет её в заказ,
        вебхук ниже записывает выручку к кампании (пуш не отправляет). Отчёт — в разделе <b>Аналитика</b>.
      </p>
      <div className="text-[13px] font-semibold mt-3">Вебхук на создание/обновление заказа</div>
      <CopyBox text={`${app}/api/v1/attribute?key=wpk_ВАШ_КЛЮЧ`} />
      <AttributionSettings projectId={id} domain={project.domain} initial={attribution} />

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

# Запустить триггерную автоматизацию по ключу
curl -X POST ${app}/api/v1/trigger \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -d '{"key":"abandoned_cart","segmentTags":["cart"]}'

# Статистика по подписчикам
curl ${app}/api/v1/subscribers \\
  -H "Authorization: Bearer wpk_ВАШ_КЛЮЧ"`}
      </pre>
    </main>
  );
}
