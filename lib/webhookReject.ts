import { createAdminClient } from "@/lib/supabase/admin";
import { describeKeySource } from "@/lib/apikey";

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
      // откуда пришёл ключ, user-agent и адрес отправителя: чтобы понять, кто стучится
      meta: [
        "key_from=" + describeKeySource(req),
        "ua=" + (req.headers.get("user-agent") || "-").slice(0, 120),
        "ip=" + ((req.headers.get("x-forwarded-for") || "-").split(",")[0] || "-").trim(),
        "ct=" + (req.headers.get("content-type") || "-").slice(0, 60),
      ].join("; "),
    });
    // хранить достаточно две недели
    await admin.from("webhook_rejects").delete().lt("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  } catch {
    /* журнал отклонений не должен ронять вебхук */
  }
}
