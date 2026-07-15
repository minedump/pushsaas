import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/apikey";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/v1/subscribers  -> active subscriber count + platform breakdown
export async function GET(req: Request) {
  const projectId = await authenticateApiKey(req);
  if (!projectId) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("subscribers")
    .select("platform")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .limit(100000);

  const rows = data ?? [];
  const byPlatform = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.platform] = (acc[r.platform] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ total: rows.length, byPlatform });
}
