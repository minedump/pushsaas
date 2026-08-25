import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAndDispatch, createAndDispatchChannel, sendWelcomeNow, resolveCascadeChannel } from "@/lib/sender";
import { enrichIdentityFields, resolveIdentitiesForProduct } from "@/lib/identity";
import { normalizePhone } from "@/lib/phone";
import { resolvePath } from "@/lib/jsonpath";

type CustomAutomation = {
  id: string;
  name: string | null;
  channel: "push" | "sms" | "email" | null;
  template_id: string | null;
  cascade: boolean | null;
  channel_templates: Record<string, string> | null;
  provider: string | null;
  platforms: string[] | null;
  spacing_enabled: boolean | null;
  spacing_minutes: number | null;
  send_window_enabled: boolean | null;
  send_days: number[] | null;
  send_time_from: string | null;
  send_time_to: string | null;
  send_window_subscriber_tz: boolean | null;
};

// Личная (одному контакту) отправка триггерной автоматизации — через ту же
// sendWelcomeNow-точку, что и welcome/событийные: каскадный выбор канала по
// приоритету (если включён), окно отправки/защита от наложения, товары из
// фида через {{ product }}/{{ products }} (payload уже содержит нужный
// product_id — из тела вебхука как есть либо явно подставленный для fan-out
// по списку избранного/корзины, см. ниже). identityId обязателен для sms/
// email — резолвим устройство под push, если канал в итоге push.
async function sendViaTemplate(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  automation: CustomAutomation,
  identityId: string,
  payload: Record<string, unknown>
): Promise<"sent" | "failed" | "skipped"> {
  let channel = automation.channel;
  let templateId = automation.template_id;
  if (automation.cascade) {
    const resolved = await resolveCascadeChannel(admin, projectId, identityId, automation.channel_templates || {});
    if (!resolved) return "skipped";
    channel = resolved.channel;
    templateId = resolved.templateId;
  }
  if (!channel || !templateId) return "skipped";

  let recipient: { subscriberId?: string; identityId?: string } = { identityId };
  if (channel === "push") {
    const { data: link } = await admin.from("identity_devices").select("subscriber_id").eq("identity_id", identityId).limit(1).maybeSingle();
    if (!link?.subscriber_id) return "skipped";
    recipient = { subscriberId: link.subscriber_id };
  }

  const { data: project } = await admin.from("projects").select("welcome_channel_provider, timezone").eq("id", projectId).maybeSingle();
  const providerHint = channel !== "push" ? automation.provider || (project?.welcome_channel_provider as Record<string, string> | null)?.[channel] || null : null;

  return sendWelcomeNow(
    admin,
    projectId,
    automation.id,
    channel,
    templateId,
    recipient,
    providerHint,
    automation.name,
    automation.spacing_enabled ? automation.spacing_minutes : null,
    {
      enabled: !!automation.send_window_enabled,
      days: automation.send_days,
      timeFrom: automation.send_time_from,
      timeTo: automation.send_time_to,
      useSubscriberTz: !!automation.send_window_subscriber_tz,
    },
    project?.timezone || "Europe/Moscow",
    "webhook",
    payload,
    automation.platforms
  );
}

// Рассылка сегменту/всем, БЕЗ каскада — единственный режим, что не резолвит
// одну identity под конкретный канал, поэтому идёт не через sendWelcomeNow, а
// через ту же кампанию-точку, что и обычные рассылки (createAndDispatch/
// createAndDispatchChannel), с телом вебхука как template_data — Liquid в
// шаблоне видит его как {{ путь }} по каждому получателю в момент реальной
// отправки. Один фиксированный канал+шаблон на всю рассылку (см.
// sendCascadeBroadcast ниже — для каскада нужен другой путь, per-identity).
async function sendBroadcast(
  projectId: string,
  automation: CustomAutomation,
  body: Record<string, unknown>,
  segmentTags: string[] | undefined
): Promise<{ ok: boolean; total: number; delivered: number; failed: number; error?: string }> {
  if (!automation.channel || !automation.template_id) {
    return { ok: false, total: 0, delivered: 0, failed: 0, error: "broadcast requires a fixed channel + template" };
  }
  if (automation.channel === "push") {
    return createAndDispatch(projectId, {
      templateId: automation.template_id,
      segmentTags,
      platforms: automation.platforms || undefined,
      type: "marketing",
      data: body,
    });
  }
  return createAndDispatchChannel(
    projectId,
    automation.channel,
    { title: automation.name || "", templateId: automation.template_id, segmentTags, providerHint: automation.provider, type: "marketing", data: body },
    undefined
  );
}

// Рассылка сегменту/всем, С каскадом — в отличие от sendBroadcast (один
// канал на всю рассылку), тут у каждого получателя СВОЙ активный канал по
// приоритету (см. resolveCascadeChannel) — единой campaign-строки на всех не
// получится, поэтому идёт per-identity через sendViaTemplate, тем же путём,
// что и «По списку товара» (list_fanout) ниже. Сегмент — по identities.tags,
// пусто — все identity проекта.
async function sendCascadeBroadcast(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  automation: CustomAutomation,
  body: Record<string, unknown>,
  segmentTags: string[] | undefined
): Promise<{ ok: boolean; total: number; delivered: number; failed: number; error?: string }> {
  if (!Object.keys(automation.channel_templates || {}).length) {
    return { ok: false, total: 0, delivered: 0, failed: 0, error: "cascade broadcast requires channel_templates configured" };
  }
  let query = admin.from("identities").select("id").eq("project_id", projectId);
  if (segmentTags?.length) query = query.overlaps("tags", segmentTags);
  const { data: identities } = await query;
  const ids = (identities || []).map((i) => i.id);

  let sent = 0;
  let failed = 0;
  for (const identityId of ids) {
    const status = await sendViaTemplate(admin, projectId, automation, identityId, body);
    if (status === "sent") sent++;
    else if (status === "failed") failed++;
  }
  return { ok: true, total: ids.length, delivered: sent, failed };
}

// Universal trigger — one endpoint for API calls AND platform webhooks.
// Auth: Bearer / X-Api-Key / ?key= / Basic-in-URL.
// Контент — ТОЛЬКО через шаблон (канал+template_id или каскад+channel_templates,
// настраивается на самой автоматизации, раздел «Триггерные»); тело вебхука
// доступно в шаблоне как Liquid-контекст ({{ путь }}, вложенные — {{ client.phone }}).
//
// The paths (phone / status match / order id) are configured ON THE AUTOMATION
// (config.phone_path, config.status_field, config.status_value, config.order_id_path),
// so the webhook URL stays clean: ?key=…&automation=order_shipped
// Any of them can be overridden per-call via query params below.
//   automation=<key>          which automation (also body.key)
//   when=<path>=<value>       condition override (else config.status_field/value)
//   phone_path=<path>         recipient override (else config.phone_path); empty = broadcast
//   segment=<tag>             broadcast segment; also segment_path (config) / body.segmentTags
//   dedupe=<path>[,<path>]     idempotency override (else built from config)
export async function POST(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const automationKey = q.get("automation") || (body.key as string) || "";
  if (!automationKey) return NextResponse.json({ error: "automation key required" }, { status: 400 });

  const admin = createAdminClient();

  const { data: proj } = await admin.from("projects").select("is_active").eq("id", projectId).single();
  if (!proj?.is_active) return NextResponse.json({ error: "project blocked" }, { status: 402 });

  // automation carries both the message (channel/template или каскад) and
  // the webhook path settings (config)
  const { data: automation } = await admin
    .from("automations")
    .select(
      "id, name, config, channel, template_id, cascade, channel_templates, provider, platforms, spacing_enabled, spacing_minutes, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz"
    )
    .eq("project_id", projectId)
    .eq("is_enabled", true)
    .eq("config->>key", automationKey)
    .maybeSingle();
  if (!automation || (!automation.template_id && !automation.cascade)) {
    return NextResponse.json({ error: "automation not found, disabled, or has no channel/template configured" }, { status: 404 });
  }
  const cfg = (automation.config || {}) as {
    transactional?: boolean;
    phone_path?: string;
    status_field?: string;
    status_value?: string;
    status_checks?: { field: string; op?: "contains" | "eq" | "gt" | "lt"; value: string }[];
    order_id_path?: string;
    segment_path?: string;
    email_path?: string;
    external_id_path?: string;
    list_fanout?: boolean;
    list_type?: string;
    product_id_path?: string;
    track_field_path?: string;
    track_mode?: "changed" | "increased" | "decreased";
  };

  // condition: query `when` overrides the automation's checks entirely; else
  // multi-condition AND from cfg.status_checks ("contains" — OR over
  // comma-separated values; "eq"/"gt"/"lt" — compare against one value) —
  // applies BEFORE the mode branch below, so it gates phone/fanout/broadcast
  // alike (e.g. "остаток > 0" for a по-списку-товара restock automation).
  const when = q.get("when");
  const checks: { field: string; op: "contains" | "eq" | "gt" | "lt"; value: string }[] = when
    ? [{ field: when.slice(0, when.indexOf("=")), op: "contains", value: when.slice(when.indexOf("=") + 1) }]
    : cfg.status_checks?.length
      ? cfg.status_checks.map((c) => ({ field: c.field, op: c.op || "contains", value: c.value }))
      : cfg.status_field && cfg.status_value
        ? [{ field: cfg.status_field, op: "contains", value: cfg.status_value }]
        : [];

  const matchedValues: string[] = [];
  for (const check of checks) {
    const raw = resolvePath(body, check.field);
    const resolved = String(raw ?? "");
    let matched: boolean;
    if (check.op === "contains") {
      matched = check.value.split(",").map((v) => v.trim()).filter(Boolean).includes(resolved);
    } else if (check.op === "eq") {
      matched = resolved === check.value.trim();
    } else {
      const num = Number(raw);
      const target = Number(check.value);
      matched = !Number.isNaN(num) && !Number.isNaN(target) && (check.op === "gt" ? num > target : num < target);
    }
    if (!matched) return NextResponse.json({ ok: true, skipped: "status not matched" });
    matchedValues.push(`${check.field}=${resolved}`);
  }

  // idempotency: query override, else composite (order id + matched conditions)
  let dedupeVal = "";
  const dedupeSpec = q.get("dedupe");
  if (dedupeSpec) {
    dedupeVal = dedupeSpec.split(",").map((p) => String(resolvePath(body, p.trim()) ?? "")).join("|");
  } else if (cfg.order_id_path) {
    dedupeVal = [String(resolvePath(body, cfg.order_id_path) ?? ""), ...matchedValues].join("|");
  }
  if (dedupeVal) {
    const { data: prior } = await admin
      .from("automation_log")
      .select("id")
      .eq("project_id", projectId)
      .contains("detail", { key: automationKey, dedupe: dedupeVal })
      .limit(1);
    if (prior?.length) return NextResponse.json({ ok: true, skipped: "already fired" });
  }

  // Fan-out по списку товара (цена снижена/товар в наличии и т.п.) — один
  // вебхук на товар превращается в персональную отправку КАЖДОМУ контакту, у
  // кого этот товар в избранном/корзине (см. resolveIdentitiesForProduct,
  // migration 0066). Пусто — значит товар ни у кого не в списке, ничего не
  // формируется и не уходит: это и есть требуемая логика "нет данных в
  // контексте — нет отправки", получаемая тут просто из пустого результата
  // запроса, без отдельного условия.
  if (cfg.list_fanout) {
    const productIdPath = cfg.product_id_path || "product_id";
    const productId = String(resolvePath(body, productIdPath) ?? "");
    if (!productId) return NextResponse.json({ ok: true, skipped: "no product id at " + productIdPath });

    // Отслеживание изменения (цена/остаток и т.п.): магазин может слать
    // вебхук по товару на каждый чих, даже если ничего не поменялось —
    // сверяем новое значение с последним, что видели по ЭТОМУ товару для
    // ЭТОЙ автоматизации (последняя запись automation_log служит кешем),
    // и уходим только при реальном (нужном по track_mode) изменении.
    let trackedValue: string | null = null;
    if (cfg.track_field_path) {
      const rawTracked = resolvePath(body, cfg.track_field_path);
      trackedValue = String(rawTracked ?? "");
      const { data: lastLog } = await admin
        .from("automation_log")
        .select("detail")
        .eq("project_id", projectId)
        .eq("automation_id", automation.id)
        .contains("detail", { product_id: productId })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastRaw = (lastLog?.detail as Record<string, unknown> | null)?.tracked_value;
      if (lastRaw != null) {
        const mode = cfg.track_mode || "changed";
        const lastValue = String(lastRaw);
        const newNum = Number(rawTracked);
        const lastNum = Number(lastRaw);
        const numericOk = !Number.isNaN(newNum) && !Number.isNaN(lastNum);
        const qualifies =
          mode === "changed"
            ? lastValue !== trackedValue
            : !numericOk
              ? false
              : mode === "increased"
                ? newNum > lastNum
                : newNum < lastNum;
        if (!qualifies) {
          // кеш обновляем ДАЖЕ на пропуске — иначе следующее сравнение шло
          // бы со старым значением, а не с реально последним увиденным (без
          // этого промежуточные вебхуки "терялись" бы для сравнения).
          await admin.from("automation_log").insert({
            project_id: projectId,
            source: "webhook",
            automation_id: automation.id,
            title: automation.name,
            status: "skipped",
            recipients: 0,
            detail: { key: automationKey, list_fanout: true, product_id: productId, tracked_value: trackedValue },
          });
          const reason = lastValue === trackedValue ? "tracked field unchanged" : "tracked field changed but not in the required direction";
          return NextResponse.json({ ok: true, skipped: reason, field: cfg.track_field_path, from: lastValue, to: trackedValue });
        }
      }
    }

    const identityIds = await resolveIdentitiesForProduct(projectId, productId, cfg.list_type || "any");
    if (!identityIds.length) return NextResponse.json({ ok: true, skipped: "product not in anyone's list", total: 0 });

    // product_id явно подставляется в payload (сверх того, что реально было
    // в теле вебхука) — так {{ product }}/{{ products }} из товарного фида
    // резолвятся независимо от того, как магазин назвал это поле у себя
    // (см. product_id_path выше) и resolveProductContext в lib/productFeed.ts.
    const fanoutPayload = { ...body, product_id: productId };
    let sent = 0;
    let failed = 0;
    for (const identityId of identityIds) {
      const status = await sendViaTemplate(admin, projectId, automation, identityId, fanoutPayload);
      if (status === "sent") sent++;
      else if (status === "failed") failed++;
    }
    await admin.from("automation_log").insert({
      project_id: projectId,
      source: "webhook",
      automation_id: automation.id,
      title: automation.name,
      status: sent > 0 ? "sent" : "skipped",
      recipients: sent,
      detail: {
        key: automationKey,
        list_fanout: true,
        product_id: productId,
        candidates: identityIds.length,
        ...(trackedValue != null ? { tracked_value: trackedValue } : {}),
      },
    });
    return NextResponse.json({ ok: true, total: identityIds.length, delivered: sent, failed });
  }

  // recipient resolution, tried in order — first that resolves an existing
  // contact wins: телефон → email → внешний ID. Ищем существующую identity
  // (никого не создаём тут — контакт должен быть уже известен системе через
  // подписку/идентификацию), затем добираем недостающие поля контакта из
  // того же тела вебхука (enrichIdentityFields — только пустые поля,
  // существующие никогда не перезаписываются).
  const phonePath = q.get("phone_path") ?? cfg.phone_path;
  const rawPhone = phonePath ? String(resolvePath(body, phonePath) ?? "") : "";
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;
  const rawEmail = cfg.email_path ? String(resolvePath(body, cfg.email_path) ?? "") : "";
  const validEmail = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail.trim().toLowerCase() : "";
  const externalId = cfg.external_id_path ? String(resolvePath(body, cfg.external_id_path) ?? "") : "";

  if (normalizedPhone || validEmail || externalId) {
    let identityId: string | null = null;
    if (normalizedPhone) {
      const { data } = await admin.from("identities").select("id").eq("project_id", projectId).eq("phone", normalizedPhone).maybeSingle();
      identityId = data?.id || null;
    }
    if (!identityId && validEmail) {
      const { data } = await admin.from("identities").select("id").eq("project_id", projectId).eq("email", validEmail).maybeSingle();
      identityId = data?.id || null;
    }
    if (!identityId && externalId) {
      const { data } = await admin.from("identities").select("id").eq("project_id", projectId).eq("insales_client_id", externalId).maybeSingle();
      identityId = data?.id || null;
    }

    if (identityId) {
      await enrichIdentityFields(identityId, {
        phone: normalizedPhone || undefined,
        email: validEmail || undefined,
        insales_client_id: externalId || undefined,
      });
      const status = await sendViaTemplate(admin, projectId, automation, identityId, body);
      await admin.from("automation_log").insert({
        project_id: projectId,
        source: "webhook",
        automation_id: automation.id,
        title: automation.name,
        status,
        recipients: status === "sent" ? 1 : 0,
        detail: { key: automationKey, ...(dedupeVal ? { dedupe: dedupeVal } : {}) },
      });
      return NextResponse.json({ ok: status !== "failed", total: 1, delivered: status === "sent" ? 1 : 0, failed: status === "failed" ? 1 : 0 });
    }
    // транзакционный режим (одному контакту) требует найденного контакта —
    // сегментный лишь опционально таргетируется, при непопадании просто
    // уходит в рассылку по сегменту ниже (не ошибка, штатный путь).
    if (cfg.transactional) return NextResponse.json({ ok: true, skipped: "no linked contact" });
  } else if (cfg.transactional) {
    return NextResponse.json({ ok: true, skipped: "no phone (transactional)" });
  }

  const segPath = q.get("segment_path") ?? cfg.segment_path;
  const fromPath = segPath ? resolvePath(body, segPath) : undefined;
  const segmentTags = q.get("segment")
    ? [q.get("segment") as string]
    : Array.isArray(fromPath)
      ? (fromPath as unknown[]).map(String)
      : fromPath != null && fromPath !== ""
        ? [String(fromPath)]
        : Array.isArray(body.segmentTags)
          ? (body.segmentTags as string[])
          : undefined;

  const result = automation.cascade
    ? await sendCascadeBroadcast(admin, projectId, automation, body, segmentTags)
    : await sendBroadcast(projectId, automation, body, segmentTags);

  await admin.from("automation_log").insert({
    project_id: projectId,
    source: "webhook",
    automation_id: automation.id,
    title: automation.name,
    status: result.ok ? "sent" : "failed",
    recipients: result.total,
    detail: { key: automationKey, ...(dedupeVal ? { dedupe: dedupeVal } : {}) },
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 402 });
  return NextResponse.json({ ok: true, delivered: result.delivered, failed: result.failed, total: result.total });
}
