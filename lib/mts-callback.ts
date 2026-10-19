import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Адрес, на который МТС Маркетолог присылает статусы доставки SMS:
//   <APP>/api/public/mts/status?key=<mts_callback_key>
// У запросов МТС нет подписи, поэтому секрет в адресе — единственная защита
// (как у вебхука заказов, см. lib/attribution.ts). Ключ создаётся при первом
// показе адреса в «Подключениях» и дальше не меняется.
export function generateMtsCallbackKey(): string {
  return "mts_" + crypto.randomBytes(24).toString("hex");
}

export async function ensureMtsCallbackKey(projectId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("project_secrets").select("mts_callback_key").eq("project_id", projectId).maybeSingle();
  if (data?.mts_callback_key) return data.mts_callback_key;

  const key = generateMtsCallbackKey();
  await admin.from("project_secrets").upsert({ project_id: projectId, mts_callback_key: key }, { onConflict: "project_id" });
  return key;
}
