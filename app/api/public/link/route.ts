import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signParam, sha256 } from "@/lib/oidc";

// Привязка «телефон ↔ устройство» после отскока со страницы входа.
// Виджет на домене магазина видит ?pss_link=<ticket> и вызывает этот роут,
// предъявляя СВОЙ device_token из localStorage (токен не ходит через URL —
// подбросить чужой тикет = привязать свой телефон к чужому устройству,
// то есть подарить доступ к своему аккаунту; угона чужого не выходит).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  const { projectId, ticket, deviceToken } = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    ticket?: string;
    deviceToken?: string;
  };
  if (!projectId || !ticket) return NextResponse.json({ error: "bad payload" }, { status: 400, headers: CORS });

  const admin = createAdminClient();
  const { data: t } = await admin
    .from("link_tickets")
    .select("id, identity_id, session_id, expires_at, consumed_at")
    .eq("id", ticket)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!t || t.consumed_at || new Date(t.expires_at) < new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410, headers: CORS });
  }
  await admin.from("link_tickets").update({ consumed_at: new Date().toISOString() }).eq("id", t.id);

  // Чьё это устройство — только по валидному device_token этого проекта
  let subscriberId: string | null = null;
  if (deviceToken) {
    const { data: sub } = await admin
      .from("subscribers")
      .select("id")
      .eq("project_id", projectId)
      .eq("device_token_hash", sha256(deviceToken))
      .maybeSingle();
    subscriberId = sub?.id || null;
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  let continueUrl: string | null = null;

  if (!t.identity_id) {
    // identify-тикет (начало входа): сообщаем сессии устройство браузера
    // и возвращаем на форму телефона
    if (t.session_id) {
      if (subscriberId) {
        await admin
          .from("oidc_auth_sessions")
          .update({ device_subscriber_id: subscriberId })
          .eq("id", t.session_id);
      }
      continueUrl = `${base}/oidc/${projectId}/auth?sid=${t.session_id}&sig=${signParam(t.session_id)}`;
    }
  } else {
    // binding-тикет (после подтверждения телефона): привязка устройства
    if (subscriberId) {
      await admin.from("identity_devices").upsert(
        { identity_id: t.identity_id, subscriber_id: subscriberId, last_used_at: new Date().toISOString() },
        { onConflict: "identity_id,subscriber_id" }
      );
    }
    if (t.session_id) {
      continueUrl = `${base}/oidc/${projectId}/continue?sid=${t.session_id}&sig=${signParam(t.session_id)}`;
    }
  }

  return NextResponse.json({ ok: true, continue: continueUrl }, { headers: CORS });
}
