import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const PLATFORMS = ["ios", "android", "desktop", "unknown"] as const;

// ";" вместо "," — это и есть стандартный разделитель списков русской
// локали Windows/Excel/Google Таблиц, поэтому файл раскладывается по
// столбцам сразу при открытии двойным кликом, без спецстрок вида "sep=,"
// (те не так надёжны — часть парсеров путает их с обычной строкой данных).
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/admin/subscribers/export?projectId=...  -> CSV download.
// Одна строка — один КОНТАКТ (identity), а не устройство: раздел
// «Подписчики» в админке сам устроен так же (см. page.tsx/SubscribersTable —
// теги переехали на identities миграцией 0037, группировка по контакту —
// более поздним заходом). У каждого контакта может быть несколько
// push-устройств (телефон+десктоп) — вместо отдельных строк на каждое они
// сведены в колонки по платформе (ios/android/desktop/unknown): "_active" —
// живо ли устройство (только чтение, факт браузера), "_paused" — ручная
// пауза мерчанта (её же можно менять через импорт, см. import/route.ts).
// Если у контакта два устройства ОДНОЙ платформы (редкий кейс, вторые
// iPhone/Android) — колонка отражает первое найденное; управление через
// импорт применяется сразу ко всем устройствам этой платформы у контакта.
//
// Устройства без привязанной identity (никто не подписывался через код)
// свою строку всё равно получают — иначе они бы выпали из выгрузки
// совсем — но с пустыми контактными полями и id вида "device-<uuid>".
//
// Произвольные колонки (кроме служебных) читаются из identities.attributes —
// это данные о ЧЕЛОВЕКЕ (например loyalty_tier из CRM мерчанта), не о
// конкретном браузере. subscribers.attributes — отдельное, не экспортируемое
// здесь хранилище: туда пишут события/автоматизации (брошенная корзина и
// т.п.), оно работает и для анонимных подписчиков без identity вообще,
// смешивать его с клиентским CSV не нужно (см. lib/sender.ts dispatchCampaign,
// /api/public/event — оба используют его независимо от identity).
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  const { data: identities } = await admin
    .from("identities")
    .select("id, phone, email, name, insales_client_id, tags, sms_marketing_active_at, email_marketing_active_at, attributes, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const { data: allSubs } = await admin
    .from("subscribers")
    .select("id, platform, is_active, paused, created_at")
    .eq("project_id", projectId);
  const subsById = new Map((allSubs ?? []).map((s) => [s.id, s]));

  const { data: links } = await admin.from("identity_devices").select("identity_id, subscriber_id");
  const devicesByIdentity = new Map<string, { platform: string; is_active: boolean; paused: boolean }[]>();
  const linkedSubIds = new Set<string>();
  for (const l of links ?? []) {
    const sub = subsById.get(l.subscriber_id);
    if (!sub) continue;
    linkedSubIds.add(sub.id);
    if (!devicesByIdentity.has(l.identity_id)) devicesByIdentity.set(l.identity_id, []);
    devicesByIdentity.get(l.identity_id)!.push({ platform: sub.platform, is_active: sub.is_active, paused: !!sub.paused });
  }

  const attrKeys = [...new Set((identities ?? []).flatMap((i) => Object.keys((i.attributes as object) || {})))];
  const platformCols = PLATFORMS.flatMap((p) => [`${p}_active`, `${p}_paused`]);
  const header = ["id", "name", "phone", "email", "insales_client_id", "tags", ...platformCols, "sms_active", "email_active", "created_at", ...attrKeys];

  const lines = [header.join(";")];
  for (const i of identities ?? []) {
    const devices = devicesByIdentity.get(i.id) ?? [];
    const byPlatform = new Map(PLATFORMS.map((p) => [p, devices.find((d) => d.platform === p)]));
    const attrs = (i.attributes as Record<string, unknown>) || {};
    const line = [
      i.id,
      i.name || "",
      // "+" перед номером — иначе Excel/Таблицы автоматически распознают
      // длинную цифровую строку как ЧИСЛО и рисуют его в экспоненциальной
      // записи ("7,92E+10") с потерей точности; ведущий "+" отключает
      // автораспознавание числа, тот же формат, что и в самой админке.
      // При импорте normalizePhone сам срезает "+" и любые не-цифры.
      i.phone ? `+${i.phone}` : "",
      i.email || "",
      i.insales_client_id || "",
      (i.tags || []).join("|"),
      ...PLATFORMS.flatMap((p) => {
        const d = byPlatform.get(p);
        return [d ? d.is_active : "", d ? d.paused : ""];
      }),
      !!i.sms_marketing_active_at,
      !!i.email_marketing_active_at,
      i.created_at,
      ...attrKeys.map((k) => attrs[k]),
    ]
      .map(csvEscape)
      .join(";");
    lines.push(line);
  }

  // Анонимные устройства (без identity вообще) — своя строка, чтобы не
  // выпадали из выгрузки, но без контактных полей и атрибутов контакта.
  for (const s of allSubs ?? []) {
    if (linkedSubIds.has(s.id)) continue;
    const line = [
      `device-${s.id}`,
      "",
      "",
      "",
      "",
      "",
      ...PLATFORMS.flatMap((p) => (p === s.platform ? [s.is_active, !!s.paused] : ["", ""])),
      false,
      false,
      s.created_at,
      ...attrKeys.map(() => ""),
    ]
      .map(csvEscape)
      .join(";");
    lines.push(line);
  }

  // BOM (﻿) — иначе Excel/Таблицы (особенно с русской локалью) открывают
  // UTF-8 CSV как ANSI-кодировку системы и превращают кириллицу в
  // кракозябры. Разделитель — ";" (см. csvEscape выше), а не спецстрока
  // "sep=,": та требует, чтобы парсер отдельно распознал и срезал строку-
  // пометку ПОСЛЕ BOM, что на практике оказалось ненадёжным (часть
  // инструментов её не понимает и путает с первой строкой данных/лишним
  // столбцом) — обычный BOM + родной для локали разделитель работает
  // предсказуемо везде. Наш собственный парсер (ExportImport.tsx: parseCsv)
  // срезает BOM перед разбором заголовков.
  return new Response("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers-${projectId}.csv"`,
    },
  });
}
