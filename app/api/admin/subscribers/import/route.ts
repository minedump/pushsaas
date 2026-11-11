import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";
import { logFieldChanges, upsertContact, addYmClientIds, setIdentityTimezone } from "@/lib/identity";
import { parseTimezone, parseYmClientId, parseYmClientIds } from "@/lib/shopFields";
import { writeAudit } from "@/lib/audit";

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
export const maxDuration = 120;

export async function POST(req: Request) {
  const { projectId, keyColumn, matchAgainst, rows, createNew } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    keyColumn?: string;
    matchAgainst?: string;
    rows?: Record<string, string>[];
    createNew?: boolean;
  };
  if (!projectId || !keyColumn || !matchAgainst || !Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "projectId, keyColumn, matchAgainst, rows required" }, { status: 400 });
  }
  if (matchAgainst !== "phone" && matchAgainst !== "email" && matchAgainst !== "insales_client_id" && matchAgainst !== "ym_client_id") {
    return NextResponse.json({ error: "Сопоставление возможно только по телефону, email, внешнему ID или UUID метрики" }, { status: 400 });
  }

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id, "import");
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  let matched = 0;
  let unmatched = 0;
  let created = 0;
  let skipped = 0;
  let deviceOnly = 0; // найдено только устройство без контакта (по UUID метрики): обновлён часовой пояс устройства

  for (const row of rows.slice(0, 5000)) {
    const rawKey = (row[keyColumn] || "").trim();
    if (!rawKey) {
      unmatched++;
      continue;
    }

    const identityPatch: Record<string, unknown> = {};
    const extra: Record<string, string> = {};
    let rowTimezone: string | null = null; // часовой пояс из файла (IANA), пишется контакту и найденным по UUID метрики устройствам
    const rowYmIds: string[] = []; // ClientID Метрики из файла: добавляются к контакту
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
      } else if (k === "timezone") {
        rowTimezone = parseTimezone(v);
        if (rowTimezone) identityPatch.timezone = rowTimezone;
      } else if (k === "ym_client_id" || k === "ym_client_ids") {
        rowYmIds.push(...parseYmClientIds(v));
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
      timezone: string | null;
    };
    const SNAPSHOT_COLS = "id, name, phone, email, insales_client_id, tags, attributes, timezone";
    let identity: IdentitySnapshot | null = null;
    let ymKey: string | null = null; // ClientID из ключевого столбца (сопоставление по UUID метрики)
    let ymDeviceIds: string[] = []; // устройства с этим ClientID
    if (matchAgainst === "ym_client_id") {
      ymKey = parseYmClientId(rawKey);
      if (ymKey) {
        // 1) контакт, у которого этот id сохранён; 2) контакт, к которому привязано устройство с этим id;
        // 3) устройство без контакта (обновим только его)
        const { data: byList } = await admin.from("identities").select(SNAPSHOT_COLS).eq("project_id", projectId).contains("ym_client_ids", [ymKey]).limit(1);
        identity = ((byList as IdentitySnapshot[] | null) ?? [])[0] ?? null;
        const { data: devs } = await admin.from("subscribers").select("id").eq("project_id", projectId).eq("attributes->>ym_client_id", ymKey);
        ymDeviceIds = (devs ?? []).map((d) => d.id as string);
        if (!identity && ymDeviceIds.length) {
          const { data: link } = await admin.from("identity_devices").select("identity_id").in("subscriber_id", ymDeviceIds).limit(1);
          const linkedId = (link ?? [])[0]?.identity_id as string | undefined;
          if (linkedId) {
            const { data } = await admin.from("identities").select(SNAPSHOT_COLS).eq("id", linkedId).maybeSingle();
            identity = (data as IdentitySnapshot | null) ?? null;
          }
        }
      }
    } else if (matchAgainst === "phone") {
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
      // Нашлось только устройство с этим UUID метрики, контакта у него нет: обновляем его часовой пояс.
      // Остальные столбцы относятся к контакту, а контакта нет.
      if (matchAgainst === "ym_client_id" && ymDeviceIds.length) {
        if (rowTimezone) await admin.from("subscribers").update({ timezone: rowTimezone }).in("id", ymDeviceIds);
        matched++;
        deviceOnly++;
        continue;
      }
      // «Создавать новых»: контакт не найден по ключу — заводим его из строки файла.
      // Нужен телефон или email: из ключа или из столбцов phone/email. Согласия только из
      // sms_active/email_active; приветственные автоматизации не запускаем (согласие уже
      // получено, файл его и фиксирует).
      if (createNew) {
        const phoneRaw = matchAgainst === "phone" ? rawKey : String(row["phone"] || "").trim();
        const emailRaw = matchAgainst === "email" ? rawKey : String(row["email"] || "").trim();
        const insalesId = matchAgainst === "insales_client_id" ? rawKey : String(row["insales_client_id"] || row["insalesClientId"] || "").trim();
        const phoneOk = phoneRaw && normalizePhone(phoneRaw) ? phoneRaw : "";
        const emailOk = emailRaw && emailRaw.includes("@") ? emailRaw : "";
        if (!phoneOk && !emailOk) {
          skipped++;
          unmatched++;
          continue;
        }
        const attrs: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(row)) {
          if (v === "" || READONLY_COLUMNS.has(k) || PAUSE_COLUMNS.has(k)) continue;
          if (["name", "phone", "email", "insales_client_id", "insalesClientId", "tags", "sms_active", "email_active", "timezone", "ym_client_id", "ym_client_ids"].includes(k) || k === keyColumn) continue;
          attrs[k] = v;
        }
        const newTags = String(row["tags"] || "")
          .split("|")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        const res = await upsertContact(projectId, {
          phone: phoneOk || undefined,
          email: emailOk || undefined,
          name: String(row["name"] || "").trim() || undefined,
          insalesClientId: insalesId || undefined,
          tags: newTags.length ? newTags : undefined,
          attributes: Object.keys(attrs).length ? attrs : undefined,
          smsActive: row["sms_active"] !== undefined && row["sms_active"] !== "" ? isTruthy(row["sms_active"]) : undefined,
          emailActive: row["email_active"] !== undefined && row["email_active"] !== "" ? isTruthy(row["email_active"]) : undefined,
          skipWelcome: true,
        });
        if (res.ok) {
          // системные поля из файла: ClientID Метрики (в том числе из ключевого столбца) и часовой пояс
          await addYmClientIds(admin, projectId, res.id, [...(ymKey ? [ymKey] : []), ...rowYmIds]);
          if (rowTimezone) await setIdentityTimezone(admin, projectId, res.id, rowTimezone);
        }
        if (res.ok && res.created) created++;
        else if (res.ok) matched++; // нашёлся по другому полю (например, по телефону) — обновлён
        else {
          skipped++;
          unmatched++;
        }
        continue;
      }
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
        const events: { project_id: string; identity_id: string; channel: "sms" | "email"; active: boolean; contact: string; source: string }[] = [];
        if ("sms_marketing_active_at" in identityPatch) {
          const phone = (identityPatch.phone as string | undefined) || (matchAgainst === "phone" ? normalizePhone(rawKey) || "" : "");
          if (phone) events.push({ project_id: projectId, identity_id: identity.id, channel: "sms", active: !!identityPatch.sms_marketing_active_at, contact: phone, source: "import" });
        }
        if ("email_marketing_active_at" in identityPatch) {
          const email = (identityPatch.email as string | undefined) || (matchAgainst === "email" ? rawKey.trim().toLowerCase() : "");
          if (email) events.push({ project_id: projectId, identity_id: identity.id, channel: "email", active: !!identityPatch.email_marketing_active_at, contact: email, source: "import" });
        }
        if (events.length) await admin.from("identity_channel_events").insert(events).then(() => {}, () => {});
      }
      // Общая история изменений (карточка подписчика) — только поля, реально
      // затронутые этой строкой файла (пустые ячейки уже отфильтрованы выше).
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of ["name", "phone", "email", "insales_client_id", "tags", "timezone"] as const) {
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

    // ClientID Метрики из файла (и ключевого столбца) добавляются к контакту, прежние не теряются
    await addYmClientIds(admin, projectId, identity.id, [...(ymKey ? [ymKey] : []), ...rowYmIds]);
    // Часовой пояс из файла при сопоставлении по UUID метрики получают и устройства с этим id
    if (rowTimezone && ymDeviceIds.length) await admin.from("subscribers").update({ timezone: rowTimezone }).in("id", ymDeviceIds);

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

  await writeAudit({ projectId, entity: "subscribers", action: "import", changes: { matched, unmatched, created, skipped, deviceOnly, matchAgainst, createNew: !!createNew } });
  return NextResponse.json({ ok: true, matched, unmatched, created, skipped, deviceOnly });
}
