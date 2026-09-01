import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signParam, sha256 } from "@/lib/oidc";

// Тихое узнавание устройства ВНЕ флоу входа — виджет дёргает это на каждой
// загрузке страницы магазина, если есть активная push-подписка. В ответ, на
// НАШЕМ домене, выставляется HttpOnly-кука с подписанным subscriber_id.
// Когда покупатель потом реально нажимает "Войти" и браузер приходит на
// /oidc/{projectId}/auth, эта кука уже там — устройство узнаётся сразу, без
// отскока за device_token в /api/public/link (см. auth/route.ts, GET).
//
// Ничего не пишем в БД — только читаем; злоупотребление (спам чужими
// device_token) не даёт атакующему ничего, кроме "моё устройство считается
// узнанным" — реальный вход всё равно требует ранее подтверждённого кода
// (см. identity_devices) и заново присланного кода при входе.
//
// SameSite=None обязателен для cross-site куки — современные браузеры
// (особенно Safari) могут её всё равно заблокировать. Тогда кука просто не
// установится, и вход поедет по старому пути отскока — деградация без
// поломки, не обязательный шаг.
function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin") || "") });
}

// Preflight (OPTIONS) не несёт тела — projectId ещё неизвестен, поэтому он
// по необходимости отражает Origin разрешительно (см. corsHeaders). Реальная
// проверка — здесь, в момент, когда projectId уже известен: куку узнавания
// выставляем, только если Origin действительно принадлежит домену ЭТОГО
// проекта (та же логика, что redirectHostAllowed в auth/route.ts), иначе
// чужая страница с любым projectId в теле не сможет добыть себе валидную
// recognize-куку чужого проекта на браузере жертвы.
function originMatchesDomain(origin: string, domain: string | null | undefined): boolean {
  if (!domain) return false;
  try {
    const host = new URL(origin).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin") || "";
  const cors = corsHeaders(origin);
  const { projectId, deviceToken } = (await req.json().catch(() => ({}))) as { projectId?: string; deviceToken?: string };
  if (!projectId || !deviceToken) return NextResponse.json({ ok: false }, { status: 400, headers: cors });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("domain").eq("id", projectId).maybeSingle();
  if (!originMatchesDomain(origin, project?.domain)) return NextResponse.json({ ok: false }, { status: 200, headers: cors });

  const { data: sub } = await admin
    .from("subscribers")
    .select("id")
    .eq("project_id", projectId)
    .eq("device_token_hash", sha256(deviceToken))
    .eq("is_active", true)
    .maybeSingle();
  if (!sub) return NextResponse.json({ ok: false }, { status: 200, headers: cors });

  const res = NextResponse.json({ ok: true }, { headers: cors });
  res.cookies.set(`pss_rec_${projectId}`, `${sub.id}.${signParam(sub.id)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: `/oidc/${projectId}/auth`,
    maxAge: 60 * 60 * 24 * 60, // 60 дней, обновляется при каждом вызове
  });
  return res;
}
