import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/phone";

// Enrich subscribers from a CSV the merchant uploaded. `keyColumn` names the
// CSV column used to find the subscriber; `matchAgainst` says how to look it
// up: "phone" or "email" (both via identities), or the name of an existing
// subscribers.attributes key (e.g. "external_id") to match by. Every other
// column merges into subscribers.attributes (rolling merge — same as event
// tracking does).
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
    for (const [k, v] of Object.entries(row)) {
      if (k !== keyColumn && v !== "") extra[k] = v;
    }

    let subscriberIds: string[] = [];
    if (matchAgainst === "phone" || matchAgainst === "email") {
      let identity: { id: string } | null = null;
      if (matchAgainst === "phone") {
        const phone = normalizePhone(rawKey);
        if (phone) {
          const { data } = await admin.from("identities").select("id").eq("project_id", projectId).eq("phone", phone).maybeSingle();
          identity = data;
        }
      } else {
        const { data } = await admin
          .from("identities")
          .select("id")
          .eq("project_id", projectId)
          .eq("email", rawKey.trim().toLowerCase())
          .maybeSingle();
        identity = data;
      }
      if (identity) {
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
    for (const sid of subscriberIds) {
      const { data: cur } = await admin.from("subscribers").select("attributes").eq("id", sid).maybeSingle();
      const merged = { ...((cur?.attributes as object) || {}), ...extra };
      await admin.from("subscribers").update({ attributes: merged }).eq("id", sid);
    }
  }

  return NextResponse.json({ ok: true, matched, unmatched });
}
