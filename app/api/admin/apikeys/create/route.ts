import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/apikey";

export async function POST(req: Request) {
  const { projectId, name } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const { raw, hash, prefix } = generateApiKey();
  const admin = createAdminClient();
  const { error } = await admin.from("api_keys").insert({
    project_id: projectId,
    name: (name || "Ключ").trim(),
    key_prefix: prefix,
    key_hash: hash,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // full key returned ONCE — never stored in plaintext
  return NextResponse.json({ key: raw, prefix });
}
