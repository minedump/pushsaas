import { createAdminClient } from "@/lib/supabase/admin";

// Пишем в api_call_log (миграция 0028) при каждом вызове /api/v1/send,
// /api/v1/attribute, /api/v1/contacts — /api/v1/trigger сюда не входит, он
// уже логируется в automation_log. Нужно для вкладки «Вебхуки/API» в
// Журнале: без этого понять "а вызвал ли меня вообще мерчант" было нечем.
// Best-effort — сбой лога не должен ронять сам ответ API.
export async function logApiCall(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  endpoint: "send" | "attribute" | "contacts",
  ok: boolean,
  error?: string | null,
  detail?: Record<string, unknown>
) {
  await admin
    .from("api_call_log")
    .insert({ project_id: projectId, endpoint, ok, error: error || null, detail: detail || {} })
    .then(
      () => {},
      () => {}
    );
}
