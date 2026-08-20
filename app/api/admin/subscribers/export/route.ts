import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/admin/subscribers/export?projectId=...  -> CSV download.
// Columns include every key already present in subscribers.attributes across
// the project, so an export→enrich→import round trip is lossless.
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("subscribers")
    .select("id, platform, tags, is_active, attributes, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const rows = subs ?? [];

  // best-effort: paused — отдельный запрос (см. lib/sender.ts excludePaused)
  const pausedIds = new Set<string>();
  if (rows.length) {
    const { data: pausedRows, error: pausedErr } = await admin
      .from("subscribers")
      .select("id")
      .eq("project_id", projectId)
      .eq("paused", true);
    if (!pausedErr) for (const r of pausedRows ?? []) pausedIds.add(r.id);
  }

  const phoneById = new Map<string, string>();
  const emailById = new Map<string, string>();
  const nameById = new Map<string, string>();
  const insalesClientIdById = new Map<string, string>();
  const smsActiveById = new Set<string>();
  const emailActiveById = new Set<string>();
  if (rows.length) {
    const { data: links } = await admin
      .from("identity_devices")
      .select("subscriber_id, identities!inner(phone, email, name, insales_client_id, sms_marketing_active_at, email_marketing_active_at)")
      .in("subscriber_id", rows.map((r) => r.id));
    for (const l of links ?? []) {
      const ident = l.identities as unknown as {
        phone: string | null;
        email: string | null;
        name: string | null;
        insales_client_id: string | null;
        sms_marketing_active_at: string | null;
        email_marketing_active_at: string | null;
      };
      if (ident?.phone) phoneById.set(l.subscriber_id, ident.phone);
      if (ident?.email) emailById.set(l.subscriber_id, ident.email);
      if (ident?.name) nameById.set(l.subscriber_id, ident.name);
      if (ident?.insales_client_id) insalesClientIdById.set(l.subscriber_id, ident.insales_client_id);
      if (ident?.sms_marketing_active_at) smsActiveById.add(l.subscriber_id);
      if (ident?.email_marketing_active_at) emailActiveById.add(l.subscriber_id);
    }
  }

  // attrKeys включает и "name" (теперь дублируется в attributes для {name} в
  // шаблонах кампаний, см. /api/public/identify) — исключаем, чтобы не
  // экспортировать одно и то же значение дважды под разными колонками.
  const attrKeys = [...new Set(rows.flatMap((r) => Object.keys((r.attributes as object) || {})))].filter((k) => k !== "name");
  const header = [
    "id",
    "name",
    "phone",
    "email",
    "insales_client_id",
    "platform",
    "tags",
    "is_active",
    "paused",
    "push_active",
    "sms_active",
    "email_active",
    "created_at",
    ...attrKeys,
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    const attrs = (r.attributes as Record<string, unknown>) || {};
    const paused = pausedIds.has(r.id);
    const line = [
      r.id,
      nameById.get(r.id) || "",
      phoneById.get(r.id) || "",
      emailById.get(r.id) || "",
      insalesClientIdById.get(r.id) || "",
      r.platform,
      (r.tags || []).join("|"),
      r.is_active,
      paused,
      r.is_active && !paused,
      smsActiveById.has(r.id),
      emailActiveById.has(r.id),
      r.created_at,
      ...attrKeys.map((k) => attrs[k]),
    ]
      .map(csvEscape)
      .join(",");
    lines.push(line);
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers-${projectId}.csv"`,
    },
  });
}
