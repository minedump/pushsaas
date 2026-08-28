import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/apikey";
import { friendlyError } from "@/lib/errors";

export async function POST(req: Request) {
  const { projectId, name, smsProvider, emailProvider } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();

  // Провайдер закрепляется за ключом только если у проекта реально есть под
  // него ключи — клиент это уже фильтрует (только настроенные в форме), но
  // сервер — последняя линия защиты, не доверяем присланному значению вслепую.
  const { data: secrets } = await admin
    .from("project_secrets")
    .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token")
    .eq("project_id", projectId)
    .maybeSingle();
  const { data: streamSecret } = await admin
    .from("project_secrets")
    .select("haskimail_marketing_stream")
    .eq("project_id", projectId)
    .maybeSingle();
  const smscReady = !!secrets?.smsc_login && !!secrets?.smsc_password;
  const smsOk = smsProvider === "bytehand" ? !!secrets?.bytehand_service_key : smsProvider === "smsc" ? smscReady : false;
  const emailOk =
    emailProvider === "haskimail"
      ? !!secrets?.haskimail_server_token && !!streamSecret?.haskimail_marketing_stream
      : emailProvider === "smsc"
      ? smscReady
      : false;

  const { raw, hash, prefix } = generateApiKey();
  const { error } = await admin.from("api_keys").insert({
    project_id: projectId,
    name: (name || "Ключ").trim(),
    key_prefix: prefix,
    key_hash: hash,
    sms_provider: smsOk ? smsProvider : null,
    email_provider: emailOk ? emailProvider : null,
  });
  if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });

  // full key returned ONCE — never stored in plaintext
  return NextResponse.json({ key: raw, prefix });
}
