import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/ratelimit";

// Public event ingestion — called from the client's site by window.pushsaas().
// Keyed by projectId; the device is identified by its push subscription endpoint.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { projectId, endpoint, name, payload } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    endpoint?: string;
    name?: string;
    payload?: Record<string, unknown>;
  };

  if (!projectId || !name?.trim()) {
    return NextResponse.json({ error: "projectId and name required" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();

  const { data: project } = await admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ error: "unknown project" }, { status: 404, headers: CORS });

  // защита от спама событиями с одного устройства/скрипта
  const allowed = await checkRateLimit(`evt:${projectId}:${endpoint || "noendpoint"}`, 60_000, 60);
  if (!allowed) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: CORS });

  // resolve the device (active subscriber) from its endpoint, if any
  let subscriberId: string | null = null;
  if (endpoint) {
    const { data: sub } = await admin
      .from("subscribers")
      .select("id")
      .eq("project_id", projectId)
      .eq("endpoint", endpoint)
      .eq("is_active", true)
      .maybeSingle();
    subscriberId = sub?.id ?? null;
  }

  // log event + schedule/cancel jobs atomically
  const { error } = await admin.rpc("ingest_event", {
    p_project_id: projectId,
    p_subscriber_id: subscriberId,
    p_name: name.trim(),
    p_payload: payload ?? {},
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });

  return NextResponse.json({ ok: true }, { headers: CORS });
}
