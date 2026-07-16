import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/ratelimit";

// Public "am I known" check — called by window.PushSaaS.isAuthenticated().
// Identifies the device by its push subscription endpoint and reports
// whether it's already linked (via a real OTP in /oidc/*/auth) to a
// phone-verified identity AND/OR an email-verified identity — independently,
// either one can be true on its own — no PII in the response, booleans only.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { projectId, endpoint } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    endpoint?: string;
  };

  if (!projectId || !endpoint) {
    return NextResponse.json({ error: "projectId, endpoint required" }, { status: 400, headers: CORS });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await checkRateLimit(`status:${projectId}:${ip}`, 60_000, 30);
  if (!allowed) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: CORS });

  const admin = createAdminClient();
  const { data: subscriber } = await admin
    .from("subscribers")
    .select("id")
    .eq("project_id", projectId)
    .eq("endpoint", endpoint)
    .eq("is_active", true)
    .maybeSingle();
  if (!subscriber) return NextResponse.json({ authenticated: false, phone: false, email: false }, { headers: CORS });

  const { data: link } = await admin
    .from("identity_devices")
    .select("identities!inner(phone_verified_at, email_verified_at)")
    .eq("subscriber_id", subscriber.id)
    .limit(1)
    .maybeSingle();
  const identity = link?.identities as unknown as { phone_verified_at: string | null; email_verified_at: string | null } | undefined;

  const phone = !!identity?.phone_verified_at;
  const email = !!identity?.email_verified_at;

  return NextResponse.json({ authenticated: phone || email, phone, email }, { headers: CORS });
}
