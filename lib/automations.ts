import { createAdminClient } from "@/lib/supabase/admin";
import { hasUnsubscribeTag } from "@/lib/unsubscribe";

export const AUTOMATION_TYPES = ["welcome", "event", "custom", "recurring"] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

export type StatusCheck = { field: string; op: "contains" | "eq" | "gt" | "lt"; value: string };

// Тот же фильтр/дефолт, что buildCustomRow в AutomationsManager.tsx —
// неполные строки (без field или value) молча отбрасываются, а не считаются
// ошибкой: то же поведение, что при ручном создании в админке.
export function normalizeStatusChecks(input: unknown): StatusCheck[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && !!String((c as Record<string, unknown>).field ?? "").trim() && !!String((c as Record<string, unknown>).value ?? "").trim())
    .map((c) => ({
      field: String(c.field).trim(),
      op: (["contains", "eq", "gt", "lt"] as const).includes(c.op as never) ? (c.op as StatusCheck["op"]) : "contains",
      value: String(c.value).trim(),
    }));
}

type Admin = ReturnType<typeof createAdminClient>;

export const AUTOMATION_SELECT =
  "id, type, name, is_enabled, channel, cascade, channel_templates, template_id, provider, platforms, segment_tags, respects_priority, delay_minutes, config, spacing_enabled, spacing_minutes, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, is_transactional, next_fire_at, last_fired_at, created_at";

// Общий маппер snake_case (БД) -> camelCase (публичный API), с раскладкой
// config в именованные поля по типу — та же форма и в списке, и в карточке
// одной автоматизации (GET /api/v1/automations и GET .../{id}).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAutomation(a: any) {
  const cfg = a.config || {};
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    isEnabled: a.is_enabled,
    channel: a.channel,
    cascade: a.cascade,
    channelTemplates: a.channel_templates || {},
    templateId: a.template_id,
    provider: a.provider,
    platforms: a.platforms || [],
    segmentTags: a.segment_tags || [],
    respectsPriority: a.respects_priority,
    delayMinutes: a.delay_minutes,
    isTransactional: !!a.is_transactional,
    ...(a.type === "event" ? { triggerEvent: cfg.trigger_event || null, cancelEvents: cfg.cancel_events || [] } : {}),
    ...(a.type === "recurring" ? { schedule: cfg.schedule || null, nextFireAt: a.next_fire_at, lastFiredAt: a.last_fired_at } : {}),
    ...(a.type === "custom"
      ? {
          key: cfg.key || null,
          recipientMode: cfg.list_fanout ? "fanout" : cfg.transactional ? "phone" : "segment",
          phonePath: cfg.phone_path || null,
          emailPath: cfg.email_path || null,
          externalIdPath: cfg.external_id_path || null,
          orderIdPath: cfg.order_id_path || null,
          segmentPath: cfg.segment_path || null,
          productIdPath: cfg.product_id_path || null,
          listType: cfg.list_type || null,
          trackFieldPath: cfg.track_field_path || null,
          trackMode: cfg.track_mode || null,
          statusChecks: cfg.status_checks || [],
        }
      : {}),
    spacing: { enabled: !!a.spacing_enabled, minutes: a.spacing_minutes },
    sendWindow: {
      enabled: !!a.send_window_enabled,
      days: a.send_days,
      timeFrom: a.send_time_from,
      timeTo: a.send_time_to,
      subscriberTz: !!a.send_window_subscriber_tz,
    },
    createdAt: a.created_at,
  };
}

// Резолвит и проверяет ссылку(и) на шаблон — обычный канал+templateId либо
// каскад (channelTemplates на каждый канал сразу, реальный канал резолвится
// в момент отправки по «Приоритету каналов», см. resolveCascadeChannel в
// lib/sender.ts). Блокирует ровно то же самое, что не даёт сохранить форму в
// AutomationsManager.tsx: шаблон не того канала, шаблон из чужого проекта,
// email-шаблон без {{ unsubscribe_url }} — кроме транзакционных автоматизаций
// (opts.transactional), им ссылка отписки не обязательна, та же семантика,
// что у campaigns.type='transactional'.
export async function resolveAutomationTemplates(
  admin: Admin,
  projectId: string,
  opts: { cascade: boolean; channel?: unknown; templateId?: unknown; channelTemplates?: unknown; transactional?: boolean }
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; error: string }> {
  if (opts.cascade) {
    const raw = (opts.channelTemplates && typeof opts.channelTemplates === "object" ? opts.channelTemplates : {}) as Record<string, unknown>;
    const entries = Object.entries(raw).filter(
      (e): e is [string, string] => ["push", "sms", "email"].includes(e[0]) && typeof e[1] === "string" && !!e[1]
    );
    if (!entries.length) return { ok: false, error: "channelTemplates required (at least one channel) when cascade is true" };

    const ids = entries.map(([, id]) => id);
    const { data: rows } = await admin.from("templates").select("id, channel, html").eq("project_id", projectId).in("id", ids);
    const byId = new Map((rows || []).map((r) => [r.id as string, r]));
    const channelTemplates: Record<string, string> = {};
    for (const [ch, id] of entries) {
      const t = byId.get(id);
      if (!t) return { ok: false, error: `template ${id} not found` };
      if (t.channel !== ch) return { ok: false, error: `template ${id} is not a ${ch} template` };
      if (ch === "email" && !opts.transactional && !hasUnsubscribeTag((t.html as string) || "")) {
        return { ok: false, error: "email template has no {{ unsubscribe_url }} tag" };
      }
      channelTemplates[ch] = id;
    }
    return { ok: true, row: { cascade: true, channel: "push", template_id: null, channel_templates: channelTemplates, provider: null } };
  }

  const channel = opts.channel;
  if (channel !== "push" && channel !== "sms" && channel !== "email") {
    return { ok: false, error: "channel must be push, sms or email (or cascade: true)" };
  }
  if (typeof opts.templateId !== "string" || !opts.templateId) return { ok: false, error: "templateId required" };
  const { data: t } = await admin.from("templates").select("id, channel, html").eq("id", opts.templateId).eq("project_id", projectId).maybeSingle();
  if (!t) return { ok: false, error: "template not found" };
  if (t.channel !== channel) return { ok: false, error: `template is not a ${channel} template` };
  if (channel === "email" && !opts.transactional && !hasUnsubscribeTag((t.html as string) || "")) {
    return { ok: false, error: "email template has no {{ unsubscribe_url }} tag" };
  }
  return { ok: true, row: { cascade: false, channel, template_id: opts.templateId, channel_templates: {} } };
}
