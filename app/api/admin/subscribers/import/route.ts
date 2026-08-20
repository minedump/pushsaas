import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";

// Enrich subscribers from a CSV the merchant uploaded. `keyColumn` names the
// CSV column used to find the subscriber; `matchAgainst` says how to look it
// up: "phone", "email" or "insales_client_id" (all three via identities), or
// the name of an existing subscribers.attributes key to match by. An
// "insales_client_id" column among the OTHER (non-key) columns also writes
// to identities.insales_client_id, not into attributes — it's a property of
// the person, not of this one device. Every remaining column merges into
// subscribers.attributes (rolling merge — same as event tracking does).
//
// `activateChannel` — явное подтверждение мерчанта "эти контакты можно
// маркетингово рассылать по SMS/Email" (только когда matchAgainst — сам
// phone/email; для остальных ключей сопоставления телефон/почта в файле
// вообще не участвуют, активировать нечего). Ставит sms_marketing_active_at/
// email_marketing_active_at — тот же флаг, что и /api/v1/contacts; НЕ
// включается неявно самим фактом импорта, чтобы не создавать согласие,
// которого мерчант не давал.
export async function POST(req: Request) {
  const { projectId, keyColumn, matchAgainst, rows, activateChannel } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    keyColumn?: string;
    matchAgainst?: string;
    rows?: Record<string, string>[];
    activateChannel?: boolean;
  };
  if (!projectId || !keyColumn || !matchAgainst || !Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "projectId, keyColumn, matchAgainst, rows required" }, { status: 400 });
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
    const extra: Record<string, string> = {};
    let insalesClientIdValue: string | undefined;
    for (const [k, v] of Object.entries(row)) {
      if (k === keyColumn || v === "") continue;
      if (k === "insales_client_id" || k === "insalesClientId") {
        insalesClientIdValue = v;
        continue;
      }
      extra[k] = v;
    }

    let subscriberIds: string[] = [];
    if (matchAgainst === "phone" || matchAgainst === "email" || matchAgainst === "insales_client_id") {
      let identity: { id: string } | null = null;
      if (matchAgainst === "phone") {
        const phone = normalizePhone(rawKey);
        if (phone) {
          const { data } = await admin.from("identities").select("id").eq("project_id", projectId).eq("phone", phone).maybeSingle();
          identity = data;
        }
      } else if (matchAgainst === "email") {
        const { data } = await admin
          .from("identities")
          .select("id")
          .eq("project_id", projectId)
          .eq("email", rawKey.trim().toLowerCase())
          .maybeSingle();
        identity = data;
      } else {
        const { data } = await admin.from("identities").select("id").eq("project_id", projectId).eq("insales_client_id", rawKey).maybeSingle();
        identity = data;
      }
      if (identity) {
        if (activateChannel && matchAgainst === "phone") {
          const phone = normalizePhone(rawKey) as string;
          await admin.from("identities").update({ sms_marketing_active_at: new Date().toISOString() }).eq("id", identity.id);
          await admin
            .from("identity_channel_events")
            .insert({ project_id: projectId, identity_id: identity.id, channel: "sms", active: true, contact: phone })
            .then(() => {}, () => {});
        }
        if (activateChannel && matchAgainst === "email") {
          const emailContact = rawKey.trim().toLowerCase();
          await admin.from("identities").update({ email_marketing_active_at: new Date().toISOString() }).eq("id", identity.id);
          await admin
            .from("identity_channel_events")
            .insert({ project_id: projectId, identity_id: identity.id, channel: "email", active: true, contact: emailContact })
            .then(() => {}, () => {});
        }
        const { data: links } = await admin.from("identity_devices").select("subscriber_id").eq("identity_id", identity.id);
        subscriberIds = (links || []).map((l) => l.subscriber_id);
      }
    } else {
      const { data: subs } = await admin
        .from("subscribers")
        .select("id")
        .eq("project_id", projectId)
        .eq(`attributes->>${matchAgainst}`, rawKey);
      subscriberIds = (subs || []).map((s) => s.id);
    }

    if (!subscriberIds.length) {
      unmatched++;
      continue;
    }
    matched++;

    if (insalesClientIdValue !== undefined) {
      const { data: links } = await admin.from("identity_devices").select("identity_id").in("subscriber_id", subscriberIds);
      const identityIds = [...new Set((links || []).map((l) => l.identity_id))];
      for (const iid of identityIds) {
        await admin.from("identities").update({ insales_client_id: insalesClientIdValue, updated_at: new Date().toISOString() }).eq("id", iid);
      }
    }

    if (Object.keys(extra).length) {
      for (const sid of subscriberIds) {
        const { data: cur } = await admin.from("subscribers").select("attributes").eq("id", sid).maybeSingle();
        const merged = { ...((cur?.attributes as object) || {}), ...extra };
        await admin.from("subscribers").update({ attributes: merged }).eq("id", sid);
      }
    }
  }

  return NextResponse.json({ ok: true, matched, unmatched });
}
