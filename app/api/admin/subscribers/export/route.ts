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
  const insalesClientIdById = new Map<string, string>();
  if (rows.length) {
    const { data: links } = await admin
      .from("identity_devices")
      .select("subscriber_id, identities!inner(phone, email, insales_client_id)")
      .in("subscriber_id", rows.map((r) => r.id));
    for (const l of links ?? []) {
      const ident = l.identities as unknown as { phone: string | null; email: string | null; insales_client_id: string | null };
      if (ident?.phone) phoneById.set(l.subscriber_id, ident.phone);
      if (ident?.email) emailById.set(l.subscriber_id, ident.email);
      if (ident?.insales_client_id) insalesClientIdById.set(l.subscriber_id, ident.insales_client_id);
    }
  }

  const attrKeys = [...new Set(rows.flatMap((r) => Object.keys((r.attributes as object) || {})))];
  const header = ["id", "phone", "email", "insales_client_id", "platform", "tags", "is_active", "paused", "created_at", ...attrKeys];

  const lines = [header.join(",")];
  for (const r of rows) {
    const attrs = (r.attributes as Record<string, unknown>) || {};
    const line = [
      r.id,
      phoneById.get(r.id) || "",
      emailById.get(r.id) || "",
      insalesClientIdById.get(r.id) || "",
      r.platform,
      (r.tags || []).join("|"),
      r.is_active,
      pausedIds.has(r.id),
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
