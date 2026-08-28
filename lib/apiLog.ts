import { createAdminClient } from "@/lib/supabase/admin";

// Пишем в api_call_log (миграция 0028/0086) только при вызовах, которые
// реально несут тело (POST/PUT — создание/правка) — GET (список/чтение) и
// DELETE (нет тела) сюда не попадают, вкладка «API» в Журнале нужна именно
// чтобы понять "что мерчант нам прислал и что мы ему ответили", а не как
// общий access-лог. Храним сырые request/response целиком (см.
// RawContextModal в карточке подписчика — тот же принцип "показать как
// есть"), а не куцую выжимку. status — реальный HTTP-код ответа: ok и error
// выводятся из него же (200-299 = успех), чтобы не разъезжались с тем, что
// вызывающий реально получил.
// Best-effort — сбой лога не должен ронять сам ответ API.
export async function logApiCall(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  endpoint: "attribute" | "subscribers" | "templates" | "campaigns" | "automations",
  status: number,
  requestBody: unknown,
  responseBody: unknown
) {
  const ok = status >= 200 && status < 300;
  const error =
    !ok && responseBody && typeof responseBody === "object" && "error" in (responseBody as object)
      ? String((responseBody as Record<string, unknown>).error)
      : null;
  await admin
    .from("api_call_log")
    .insert({ project_id: projectId, endpoint, ok, status_code: status, error, request_body: requestBody ?? {}, response_body: responseBody ?? {} })
    .then(
      () => {},
      () => {}
    );
}
