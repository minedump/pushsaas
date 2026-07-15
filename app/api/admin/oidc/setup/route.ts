import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { ensureOidcClient, issuerFor } from "@/lib/oidc";

// Включение входа по телефону: создаёт OIDC-конфигурацию проекта
// (client_id, RSA-ключ) и выпускает client_secret. Секрет показывается ОДИН раз.
// regenerate: true — перевыпуск секрета для существующей конфигурации.
export async function POST(req: Request) {
  const { projectId, regenerate } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const { clientId, clientSecret } = await ensureOidcClient(projectId, { regenerateSecret: !!regenerate });
  return NextResponse.json({
    clientId,
    clientSecret, // null, если конфигурация уже существовала и секрет не перевыпускался
    issuer: issuerFor(projectId),
  });
}
