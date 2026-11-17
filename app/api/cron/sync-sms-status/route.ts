import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkSmsDelivery } from "@/lib/otp/sms";
import { checkSmscDelivery } from "@/lib/otp/smsc";

// Опрос статусов SMS-рассылок у Bytehand и SMSC. Для МТС отдельно не нужен: он сам присылает статусы
// обратным запросом (app/api/public/mts/status). Без опроса «Отправлено» у этих провайдеров значит только
// «принято», а подтверждённая доставка («Доставлено») и отказы оставались бы пустыми.
//
// Берём получателей, которых провайдер принял (status = delivered), но оператор ещё не подтвердил доставку
// (delivered_at пуст), за последние сутки (SMSC отдаёт статус в течение суток). Каждого опрашиваем не чаще раза
// в 3 минуты (у SMSC лимит 5 одинаковых запросов в минуту). Результат пишем тем же apply_sms_delivery_status,
// что и обратный вызов МТС: подтверждённая доставка увеличивает confirmed_count, окончательный провал переводит
// получателя в failed и пересчитывает счётчики рассылки; причину отказа кладём в provider_error.
// Protected by CRON_SECRET.
export const maxDuration = 60;

const BATCH = 200;
const CONCURRENCY = 10;
const RECHECK_MINUTES = 3;
const MAX_AGE_HOURS = 24;
const TIME_BUDGET_MS = 45_000;

type Row = {
  id: string;
  project_id: string;
  contact: string;
  provider_message_id: string;
  campaigns: { provider: string | null } | { provider: string | null }[] | null;
};

type Secrets = { smsc_login: string | null; smsc_password: string | null; bytehand_service_key: string | null };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();
  const recheckBefore = new Date(Date.now() - RECHECK_MINUTES * 60_000).toISOString();
  const createdAfter = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000).toISOString();

  const { data } = await admin
    .from("campaign_recipients")
    .select("id, project_id, contact, provider_message_id, campaigns!inner(provider)")
    .eq("channel", "sms")
    .eq("status", "delivered")
    .is("delivered_at", null)
    .not("provider_message_id", "is", null)
    .gt("created_at", createdAfter)
    .in("campaigns.provider", ["bytehand", "smsc"])
    .or(`provider_status_at.is.null,provider_status_at.lt.${recheckBefore}`)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  const rows = (data ?? []) as unknown as Row[];

  const secretsByProject = new Map<string, Secrets | null>();
  async function secretsFor(projectId: string): Promise<Secrets | null> {
    if (secretsByProject.has(projectId)) return secretsByProject.get(projectId)!;
    const { data: s } = await admin.from("project_secrets").select("smsc_login, smsc_password, bytehand_service_key").eq("project_id", projectId).maybeSingle();
    secretsByProject.set(projectId, (s as Secrets | null) ?? null);
    return (s as Secrets | null) ?? null;
  }

  let delivered = 0;
  let failed = 0;
  let pending = 0;

  async function checkOne(r: Row) {
    const provider = (Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns)?.provider;
    const secrets = await secretsFor(r.project_id);
    if (!secrets) return;
    let check: { state: "pending" | "delivered" | "failed"; detail: string | null };
    if (provider === "bytehand") {
      if (!secrets.bytehand_service_key) return;
      check = await checkSmsDelivery(secrets.bytehand_service_key, r.provider_message_id);
    } else if (provider === "smsc") {
      if (!secrets.smsc_login || !secrets.smsc_password) return;
      check = await checkSmscDelivery(secrets.smsc_login, secrets.smsc_password, r.provider_message_id, r.contact);
    } else {
      return;
    }

    await admin.rpc("apply_sms_delivery_status", {
      p_project: r.project_id,
      p_message_id: r.provider_message_id,
      p_status: check.detail || check.state,
      p_final_failed: check.state === "failed",
      p_delivered: check.state === "delivered",
    });
    if (check.state === "failed" && check.detail) {
      await admin.from("campaign_recipients").update({ provider_error: check.detail }).eq("id", r.id);
    }
    if (check.state === "delivered") delivered++;
    else if (check.state === "failed") failed++;
    else pending++;
  }

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    await Promise.all(rows.slice(i, i + CONCURRENCY).map((r) => checkOne(r).catch((e) => console.error("[sync-sms-status]", e instanceof Error ? e.message : e))));
  }

  return NextResponse.json({ ok: true, checked: delivered + failed + pending, delivered, failed, pending });
}
