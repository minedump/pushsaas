import { NextResponse } from "next/server";
import { extractWebhookKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertContact, namePatch, logFieldChanges, applyShopConsent, isTruthyFlag, addYmClientIds, setIdentityTimezone, setIdentityTelegramId } from "@/lib/identity";
import { mapShopFields, type FieldMapRow } from "@/lib/shopFields";
import { normalizePhone } from "@/lib/phone";
import { logApiCall } from "@/lib/apiLog";
import { auditAs } from "@/lib/auditContext";
import { logWebhookReject } from "@/lib/webhookReject";

// POST /api/v1/client — вебхук магазина «клиент зарегистрировался / изменил данные»
// (InSales: clients/create и clients/update). Тот же токен, что у вебхука заказов
// (project_secrets.attribution_token, Настройки). Тело — объект клиента InSales
// (на верхнем уровне или внутри `client`): id, name, surname, email, phone,
// subscribe, registered, bonus_points, fields_values.
//
//  · контакт ищем по внешнему id (insales_client_id), затем по телефону — это пара ключей
//    контакта; по email ищем, только если в вебхуке нет телефона; нет — заводим;
//  · обновляем имя, телефон, email, внешний id (insales_client_id) и доп. поля: бонусы и
//    поля магазина по соответствию из Настроек (projects.client_field_map);
//  · согласия на каналы приходят отсюда же и меняются в обе стороны (и при
//    регистрации, и при правке в личном кабинете магазина):
//      email — системное поле клиента subscribe (true даёт согласие, false снимает);
//      SMS   — дополнительное поле клиента, его handle задан в Настройках
//              (projects.client_sms_field). Есть поле в теле: значение «да» даёт
//              согласие, «нет» снимает. Поля в теле нет — SMS не трогаем.
//    Каналы независимы: отписка от SMS не касается email и наоборот. Приветственные
//    автоматизации не запускаем: согласие получено и хранится в магазине.
// Галочки при оформлении заказа обрабатывает вебхук заказов: только включает согласия.
export const maxDuration = 30;

type Obj = Record<string, unknown>;

type Ident = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  phone: string | null;
  email: string | null;
  insales_client_id: string | null;
  attributes: Record<string, unknown> | null;
  sms_marketing_active_at: string | null;
  email_marketing_active_at: string | null;
};
const COLS = "id, name, first_name, last_name, middle_name, phone, email, insales_client_id, attributes, sms_marketing_active_at, email_marketing_active_at";

export async function POST(req: Request) {
  const token = extractWebhookKey(req);
  if (!token) {
    await logWebhookReject("client", 401, "missing key", req);
    return NextResponse.json({ error: "missing key" }, { status: 401 });
  }

  const authAdmin = createAdminClient();
  const { data: secretRow } = await authAdmin.from("project_secrets").select("project_id").eq("attribution_token", token).maybeSingle();
  const projectId = secretRow?.project_id;
  if (!projectId) {
    await logWebhookReject("client", 401, "invalid key", req, { key: token });
    return NextResponse.json({ error: "invalid key" }, { status: 401 });
  }

  // Правки контакта из этого вебхука в истории карточки подписаны источником «вебхук магазина».
  auditAs(null, "webhook");
  const admin = createAdminClient();

  const body = (await req.json().catch(() => ({}))) as Obj;
  const client = ((body.client && typeof body.client === "object" ? body.client : body) as Obj) || {};

  const respond = async (status: number, responseBody: Obj) => {
    await logApiCall(admin, projectId, "contacts", status, body, responseBody);
    return NextResponse.json(responseBody, { status });
  };

  const { data: projRow } = await admin.from("projects").select("client_sms_field, client_field_map").eq("id", projectId).maybeSingle();
  const projCfg = projRow as { client_sms_field?: string | null; client_field_map?: unknown } | null;
  const smsField = String(projCfg?.client_sms_field || "").trim().toLowerCase();
  const fieldMap = (Array.isArray(projCfg?.client_field_map) ? projCfg!.client_field_map : []) as { handle?: string; key?: string }[];
  // поле клиента из тела вебхука: по handle, названию или id поля
  const findField = (want: string): Obj | undefined =>
    Array.isArray(client.fields_values)
      ? (client.fields_values as Obj[]).find((x) => [x?.handle, x?.name, x?.field_id].some((k) => k != null && String(k).trim().toLowerCase() === want.trim().toLowerCase()))
      : undefined;

  const insalesId = client.id != null && client.id !== "" ? String(client.id) : "";
  const phone = client.phone ? normalizePhone(String(client.phone)) : null;
  const email = client.email ? String(client.email).trim().toLowerCase() : null;
  if (!insalesId && !phone && !email) {
    await logWebhookReject("client", 400, "client id, phone or email required", req, { body });
    return respond(400, { error: "client id, phone or email required" });
  }

  // InSales: name это имя, surname фамилия, middlename отчество. Пустые значения пропускаем.
  const nameIn = {
    firstName: String(client.name ?? "").trim() || undefined,
    lastName: String(client.surname ?? "").trim() || undefined,
    middleName: String(client.middlename ?? client.middle_name ?? "").trim() || undefined,
  };

  // доп. поля контакта: бонусы и регистрация (системные поля клиента)
  const attrs: Record<string, string | null> = {};
  if (client.bonus_points != null) attrs.bonus_points = String(client.bonus_points);
  // Доп. поля клиента сохраняем только по соответствию из Настроек (поле магазина → поле контакта).
  // Пустое значение убирает поле у контакта, поля нет в теле вебхука — не трогаем.
  // Системные поля контакта (часовой пояс, ClientID Метрики) разбираются отдельно, остальные уходят в доп. поля.
  const mapped = mapShopFields(fieldMap as FieldMapRow[], findField);
  Object.assign(attrs, mapped.custom);
  if (typeof client.registered === "boolean") attrs.shop_registered = client.registered ? "1" : "0";

  // Ключи контакта: внешний id клиента магазина (первым) и телефон. Email для поиска не используем:
  // его находим только у клиента без телефона, когда другого ключа в вебхуке нет.
  let identity: Ident | null = null;
  if (insalesId) {
    // limit(1) вместо maybeSingle: если по ошибке два контакта с одним id, берём самый старый, а не падаем
    const { data } = await admin.from("identities").select(COLS).eq("project_id", projectId).eq("insales_client_id", insalesId).order("created_at", { ascending: true }).limit(1);
    identity = ((data as Ident[] | null) ?? [])[0] ?? null;
  }
  if (!identity && phone) {
    const { data } = await admin.from("identities").select(COLS).eq("project_id", projectId).eq("phone", phone).maybeSingle();
    identity = (data as Ident | null) ?? null;
  }
  if (!identity && !phone && email) {
    const { data } = await admin.from("identities").select(COLS).eq("project_id", projectId).eq("email", email).maybeSingle();
    identity = (data as Ident | null) ?? null;
  }

  // Контакт найден по телефону или email, а у него уже другой внешний id: это другая учётная
  // запись магазина с тем же человеком (например, гостевой клиент при оформлении заказа).
  // Такие данные только дополняют контакт: имя и id не перезаписываем, пустые поля не стираем,
  // согласия только включаем.
  const differentAccount = !!identity && !!identity.insales_client_id && !!insalesId && identity.insales_client_id !== insalesId;

  let created = false;
  let identityId: string;
  const notes: string[] = [];

  if (!identity) {
    if (!phone && !email) return respond(200, { ok: true, skipped: "no phone or email, contact not created" });
    // email уже у другого контакта, а ключи (id и телефон) новые: заводим контакт без этого email
    let newEmail = email;
    if (phone && email) {
      const { data: taken } = await admin.from("identities").select("id").eq("project_id", projectId).eq("email", email).maybeSingle();
      if (taken) {
        newEmail = null;
        notes.push("email already belongs to another contact");
      }
    }
    const res = await upsertContact(projectId, { phone, email: newEmail, ...nameIn, insalesClientId: insalesId || undefined, attributes: attrs });
    if (!res.ok) {
      await logWebhookReject("client", 400, res.error, req, { body });
      return respond(400, { error: res.error });
    }
    created = true;
    identityId = res.id;
  } else {
    const current: Ident = identity;
    identityId = current.id;
    const patch: Obj = {};
    const before: Obj = {};
    const after: Obj = {};
    const set = (key: "phone" | "email" | "insales_client_id", value: string | null | undefined) => {
      if (!value || value === current[key]) return;
      patch[key] = value;
      before[key] = current[key];
      after[key] = value;
    };
    // ФИО: у другой учётной записи магазина только дополняем пустое, иначе обновляем
    const np = namePatch(nameIn, current, { fillOnly: differentAccount });
    for (const [key, value] of Object.entries(np)) {
      if (value === (current as unknown as Obj)[key]) continue;
      patch[key] = value;
      before[key] = (current as unknown as Obj)[key];
      after[key] = value;
    }
    if (!differentAccount) set("insales_client_id", insalesId);
    // телефон/email меняем, только если они не заняты другим контактом
    for (const [key, value] of [["phone", phone], ["email", email]] as const) {
      if (!value || value === current[key]) continue;
      const { data: other } = await admin.from("identities").select("id").eq("project_id", projectId).eq(key, value).neq("id", identityId).maybeSingle();
      if (other) notes.push(`${key} already belongs to another contact`);
      else set(key, value);
    }
    if (Object.keys(attrs).length) {
      const merged = { ...(current.attributes || {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(attrs)) {
        if (differentAccount && (v === null || merged[k] != null)) continue;
        if ((merged[k] ?? null) !== v) {
          before[`attr:${k}`] = merged[k];
          after[`attr:${k}`] = v;
          if (v === null) delete merged[k];
          else merged[k] = v;
        }
      }
      patch.attributes = merged;
    }
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      await admin.from("identities").update(patch).eq("id", identityId);
      logFieldChanges(admin, projectId, identityId, before, after);
    }
  }

  // Согласия на каналы (см. шапку): желаемое состояние из тела вебхука.
  // флажок email учитываем, только если у клиента магазина указан email; нет email — ничего не отписываем
  const wantEmail: boolean | undefined = typeof client.subscribe === "boolean" && email ? client.subscribe : undefined;
  let wantSms: boolean | undefined;
  if (smsField && phone) {
    const f = findField(smsField);
    if (f) wantSms = isTruthyFlag(f.value);
  }
  const consentChanged = await applyShopConsent(admin, projectId, identityId, { sms: wantSms, email: wantEmail }, { source: "webhook", grantOnly: differentAccount });

  // Системные поля из соответствия полей: часовой пояс и ClientID Метрики (у контакта их может быть
  // несколько, новые дописываются). У другой учётной записи магазина (гость с тем же телефоном)
  // часовой пояс не перезаписываем.
  if (mapped.timezone) await setIdentityTimezone(admin, projectId, identityId, mapped.timezone, differentAccount);
  if (mapped.telegramId) await setIdentityTelegramId(admin, projectId, identityId, mapped.telegramId, differentAccount);
  if (mapped.ymIds.length) await addYmClientIds(admin, projectId, identityId, mapped.ymIds);
  notes.push(...mapped.notes);

  return respond(200, { ok: true, created, updated: !created, consent: consentChanged, ...(notes.length ? { notes } : {}) });
}
