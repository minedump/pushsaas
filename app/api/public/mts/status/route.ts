import { createAdminClient } from "@/lib/supabase/admin";
import { classifyMtsStatus } from "@/lib/otp/mts";

// Статусы доставки SMS от МТС Маркетолога (обратный запрос). Адрес с секретным
// ключом показывается в «Подключениях» → «МТС Маркетолог»; его нужно указать в
// кабинете МТС при создании подключения API.
//
// Тело: { items: [{ message_id, internal_id, status, ... }] }. МТС требует
// ответ 204 (иначе повторяет доставку три дня), поэтому на любые статусы,
// включая незнакомые, отвечаем 204. Неверный ключ — 401: это ошибка настройки,
// её нужно заметить.
//
// Получателя находим по id сообщения, который мы сохранили при отправке
// (campaign_recipients.provider_message_id). В документации не уточнено, какой
// именно из двух id приходит в сообщении, поэтому пробуем оба. Окончательный
// провал (NotSent, NotDelivered) переводит получателя в failed и пересчитывает
// счётчики кампании (см. миграцию 0107).
export const maxDuration = 30;

type Item = { message_id?: string | number; internal_id?: string | number; status?: string | number };

export async function POST(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return new Response(null, { status: 401 });

  const admin = createAdminClient();
  const { data: owner } = await admin.from("project_secrets").select("project_id").eq("mts_callback_key", key).maybeSingle();
  if (!owner) return new Response(null, { status: 401 });

  const body = (await req.json().catch(() => null)) as { items?: Item[] } | null;
  const items = Array.isArray(body?.items) ? body!.items!.slice(0, 1000) : [];

  const apply = async (item: Item) => {
    const failed = classifyMtsStatus(item.status) === "failed";
    const ids = [...new Set([item.message_id, item.internal_id].filter((v) => v != null && v !== "").map(String))];
    for (const id of ids) {
      const { data: found } = await admin.rpc("apply_sms_delivery_status", {
        p_project: owner.project_id,
        p_message_id: id,
        p_status: String(item.status ?? ""),
        p_final_failed: failed,
      });
      if (found) {
        console.log("[mts-status]", JSON.stringify({ message_id: item.message_id, internal_id: item.internal_id, status: item.status, matched: id }));
        return;
      }
    }
    // не нашли получателя: тестовая отправка, SMS кода входа или другой id — id и статус нужны, чтобы понять, какой id присылает МТС
    console.log("[mts-status]", JSON.stringify({ message_id: item.message_id, internal_id: item.internal_id, status: item.status, matched: null }));
  };

  const CONCURRENCY = 10;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map((it) => apply(it).catch((e) => console.error("[mts-status]", e instanceof Error ? e.message : e))));
  }
  return new Response(null, { status: 204 });
}
