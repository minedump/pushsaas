import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export function generateAttributionToken(): string {
  return "attr_" + crypto.randomBytes(24).toString("hex");
}

// Токен генерируется один раз, при создании проекта (см.
// app/api/admin/projects/create) — эта функция просто читает его. Фолбэк
// для проектов, созданных до миграции 0073: генерирует и сохраняет, если
// вдруг ещё не было.
export async function ensureAttributionToken(projectId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("project_secrets").select("attribution_token").eq("project_id", projectId).maybeSingle();
  if (data?.attribution_token) return data.attribution_token;

  const token = generateAttributionToken();
  await admin.from("project_secrets").upsert({ project_id: projectId, attribution_token: token }, { onConflict: "project_id" });
  return token;
}
