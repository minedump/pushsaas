import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { logFieldChanges } from "@/lib/identity";

const PLATFORMS = ["ios", "android", "desktop", "unknown"] as const;

// Колонки из /api/admin/subscribers/export, которые не редактируются через
// импорт вообще — вычисляемые/устройство-специфичные факты (id, "живо ли"
// устройство по платформе, дата создания). Если пользователь реимпортирует
// файл БЕЗ изменений (типичный кейс: выгрузили — поправили пару строк —
// загрузили обратно), эти колонки не должны улетать в identities.attributes
// мусором.
const READONLY_COLUMNS = new Set(["id", "created_at", ...PLATFORMS.map((p) => `${p}_active`)]);
const PAUSE_COLUMNS = new Set(PLATFORMS.map((p) => `${p}_paused`));

function isTruthy(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "да";
}

// Enrich contacts from a CSV the merchant uploaded. `keyColumn` names the
// CSV column used to find the contact; `matchAgainst` says how to look it
// up — ТОЛЬКО "phone", "email" или "insales_client_id" (все три резолвятся
// через identities). Одна строка файла = один КОНТАКТ (см. export/route.ts —
// та же строка, что видна в разделе «Подписчики»), не устройство.
//
// Колонки файла делятся на четыре группы:
//   1. READONLY_COLUMNS — игнорируются молча (см. выше).
//   2. Распознанные поля контакта (name/phone/email/insales_client_id/tags/
//      sms_active/email_active) — пишутся в identities, ТЕ ЖЕ поля, что
//      редактируются вручную на странице подписчика.
//   3. "{platform}_paused" (ios_paused/android_paused/desktop_paused/
//      unknown_paused) — булево, ставит/снимает ручную паузу СРАЗУ на всех
//      устройствах контакта этой платформы (обычно оно одно).
//   4. Всё остальное — произвольные атрибуты КОНТАКТА (например
//      loyalty_tier из CRM мерчанта) — мёржатся в identities.attributes.
//      Это НЕ то же самое, что subscribers.attributes: там живут
//      поведенческие/событийные данные конкретного устройства (корзина,
//      последний просмотр — см. /api/public/event, lib/sender.ts
//      dispatchCampaign), которые нужны и анонимным подписчикам без
//      identity вообще — CSV-импорт клиентов их не трогает.
// Пустая ячейка = «не трогать это поле», а не «очистить».
export async function POST(req: Request) {
  const { projectId, keyColumn, matchAgainst, rows } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    keyColumn?: string;
    matchAgainst?: string;
    rows?: Record<string, string>[];
  };
  if (!projectId || !keyColumn || !matchAgainst || !Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "projectId, keyColumn, matchAgainst, rows required" }, { status: 400 });
  }
  if (matchAgainst !== "phone" && matchAgainst !== "email" && matchAgainst !== "insales_client_id") {
    return NextResponse.json({ error: "Сопоставление возможно только по телефону, email или внешнему ID" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  let matched = 0;
  let unmatched = 0;

  for (const row of rows.slice(0, 5000)) {
    const rawKey = (row[keyColumn] || "").trim();
    if (!rawKey) {
      unmatched++;
      continue;
    }

    const identityPatch: Record<string, unknown> = {};
    const extra: Record<string, string> = {};
    const pausePatch: Partial<Record<(typeof PLATFORMS)[number], boolean>> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === keyColumn || v === "" || READONLY_COLUMNS.has(k)) continue;
      if (PAUSE_COLUMNS.has(k)) {
        pausePatch[k.replace("_paused", "") as (typeof PLATFORMS)[number]] = isTruthy(v);
      } else if (k === "insales_client_id" || k === "insalesClientId") {
        identityPatch.insales_client_id = v.trim();
      } else if (k === "name") {
        identityPatch.name = v.trim();
      } else if (k === "phone") {
        const p = normalizePhone(v);
        if (p) identityPatch.phone = p;
      } else if (k === "email") {
        identityPatch.email = v.trim().toLowerCase();
      } else if (k === "tags") {
        identityPatch.tags = v
          .split("|")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
      } else if (k === "sms_active") {
        identityPatch.sms_marketing_active_at = isTruthy(v) ? new Date().toISOString() : null;
      } else if (k === "email_active") {
        identityPatch.email_marketing_active_at = isTruthy(v) ? new Date().toISOString() : null;
      } else {
        extra[k] = v;
      }
    }

    type IdentitySnapshot = {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      insales_client_id: string | null;
      tags: string[] | null;
      attributes: Record<string, unknown> | null;
    };
    const SNAPSHOT_COLS = "id, name, phone, email, insales_client_id, tags, attributes";
    let identity: IdentitySnapshot | null = null;
    if (matchAgainst === "phone") {
      const phone = normalizePhone(rawKey);
      if (phone) {
        const { data } = await admin.from("identities").select(SNAPSHOT_COLS).eq("project_id", projectId).eq("phone", phone).maybeSingle();
        identity = data;
      }
    } else if (matchAgainst === "email") {
      const { data } = await admin
        .from("identities")
        .select(SNAPSHOT_COLS)
        .eq("project_id", projectId)
        .eq("email", rawKey.trim().toLowerCase())
        .maybeSingle();
      identity = data;
    } else {
      const { data } = await admin.from("identities").select(SNAPSHOT_COLS).eq("project_id", projectId).eq("insales_client_id", rawKey).maybeSingle();
      identity = data;
    }

    if (!identity) {
      unmatched++;
      continue;
    }
    matched++;

    if (Object.keys(extra).length) {
      identityPatch.attributes = { ...(identity.attributes || {}), ...extra };
    }

    if (Object.keys(identityPatch).length) {
      identityPatch.updated_at = new Date().toISOString();
      await admin.from("identities").update(identityPatch).eq("id", identity.id);
      if ("sms_marketing_active_at" in identityPatch || "email_marketing_active_at" in identityPatch) {
        const events: { project_id: string; identity_id: string; channel: "sms" | "email"; active: boolean; contact: string }[] = [];
        if ("sms_marketing_active_at" in identityPatch) {
          const phone = (identityPatch.phone as string | undefined) || (matchAgainst === "phone" ? normalizePhone(rawKey) || "" : "");
          if (phone) events.push({ project_id: projectId, identity_id: identity.id, channel: "sms", active: !!identityPatch.sms_marketing_active_at, contact: phone });
        }
        if ("email_marketing_active_at" in identityPatch) {
          const email = (identityPatch.email as string | undefined) || (matchAgainst === "email" ? rawKey.trim().toLowerCase() : "");
          if (email) events.push({ project_id: projectId, identity_id: identity.id, channel: "email", active: !!identityPatch.email_marketing_active_at, contact: email });
        }
        if (events.length) await admin.from("identity_channel_events").insert(events).then(() => {}, () => {});
      }
      // Общая история изменений (карточка подписчика) — только поля, реально
      // затронутые этой строкой файла (пустые ячейки уже отфильтрованы выше).
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of ["name", "phone", "email", "insales_client_id", "tags"] as const) {
        if (key in identityPatch) {
          before[key] = identity[key];
          after[key] = identityPatch[key];
        }
      }
      if (Object.keys(extra).length) {
        for (const key of Object.keys(extra)) {
          before[`attr:${key}`] = identity.attributes?.[key];
          after[`attr:${key}`] = extra[key];
        }
      }
      logFieldChanges(admin, projectId, identity.id, before, after);
    }

    if (Object.keys(pausePatch).length) {
      const { data: linkedSubs } = await admin
        .from("identity_devices")
        .select("subscriber_id, subscribers!inner(id, platform)")
        .eq("identity_id", identity.id);
      for (const l of linkedSubs || []) {
        const platform = (l.subscribers as unknown as { platform: string }).platform as (typeof PLATFORMS)[number];
        if (platform in pausePatch) {
          await admin.from("subscribers").update({ paused: pausePatch[platform] }).eq("id", l.subscriber_id);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, matched, unmatched });
}
