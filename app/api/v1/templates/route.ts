import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/v1/templates   (Authorization: Bearer wpk_... | X-Api-Key: wpk_...)
// Список шаблонов проекта (id, name, channel) — id подставляется в
// /api/v1/send как templateId. ?channel=push|sms|email фильтрует по каналу.
export async function GET(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const channel = new URL(req.url).searchParams.get("channel");

  const admin = createAdminClient();
  let q = admin.from("templates").select("id, name, channel").eq("project_id", projectId).order("updated_at", { ascending: false });
  if (channel === "push" || channel === "sms" || channel === "email") q = q.eq("channel", channel);
  const { data: templates, error } = await q;
  if (error) return NextResponse.json({ templates: [] });

  return NextResponse.json({ templates: templates ?? [] });
}
