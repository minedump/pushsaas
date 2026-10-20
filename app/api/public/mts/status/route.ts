import { createAdminClient } from "@/lib/supabase/admin";
import { classifyMtsStatus } from "@/lib/otp/mts";

// Статусы доставки SMS от МТС Маркетолога (обратный запрос). Адрес с секретным
// ключом показывается в «Подключениях» → «МТС Маркетолог»; его нужно указать в
// кабинете МТС при создании подключения API.
//
// Тело: { items: [{ message_id, status, ... }] }, status — числовой код (300 —
// доставлено). МТС требует
// ответ 204 (иначе повторяет доставку три дня), поэтому на любые статусы,
// включая незнакомые, отвечаем 204. Неверный ключ — 401: это ошибка настройки,
// её нужно заметить.
//
// Получателя находим по message_id: он совпадает с id, который мы сохранили при
// отправке (campaign_recipients.provider_message_id). Окончательный провал
// переводит получателя в failed и пересчитывает счётчики кампании (миграция 0107).
export const maxDuration = 30;

type Item = { message_id?: string | number; status?: string | number };

export async function POST(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return new Response(null, { status: 401 });

  const admin = createAdminClient();
  const { data: owner } = await admin.from("project_secrets").select("project_id").eq("mts_callback_key", key).maybeSingle();
  if (!owner) return new Response(null, { status: 401 });

  const body = (await req.json().catch(() => null)) as { items?: Item[] } | null;
  const items = Array.isArray(body?.items) ? body!.items!.slice(0, 1000) : [];

  const apply = async (item: Item) => {
    if (item.message_id == null || item.message_id === "") return;
    await admin.rpc("apply_sms_delivery_status", {
      p_project: owner.project_id,
      p_message_id: String(item.message_id),
      p_status: String(item.status ?? ""),
      p_final_failed: classifyMtsStatus(item.status) === "failed",
    });
  };

  const CONCURRENCY = 10;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map((it) => apply(it).catch((e) => console.error("[mts-status]", e instanceof Error ? e.message : e))));
  }
  return new Response(null, { status: 204 });
}
