import { createAdminClient } from "@/lib/supabase/admin";

// Запись отклонённого вызова вебхука магазина (см. миграцию 0112). Best-effort:
// сбой записи не должен менять ответ магазину. Ключ в таблицу не попадает,
// только подсказка из начала и длины.
export async function logWebhookReject(
  endpoint: "attribute" | "client",
  status: number,
  reason: string,
  req: Request,
  opts: { key?: string | null; body?: unknown } = {}
): Promise<void> {
  try {
    let body: string | null = null;
    if (opts.body !== undefined) body = JSON.stringify(opts.body).slice(0, 4000);
    else {
      try {
        body = (await req.clone().text()).slice(0, 4000) || null;
      } catch {
        body = null;
      }
    }
    const key = opts.key || null;
    const admin = createAdminClient();
    await admin.from("webhook_rejects").insert({
      endpoint,
      status_code: status,
      reason,
      key_hint: key ? `${key.slice(0, 4)}…(${key.length})` : null,
      method: req.method,
      body,
    });
    // хранить достаточно две недели
    await admin.from("webhook_rejects").delete().lt("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  } catch {
    /* журнал отклонений не должен ронять вебхук */
  }
}
