// Разделы, на которые можно ограничить API-ключ (см. миграцию 0095) — те же
// 4 группы, что и в документации (lib/apiSpec.ts API_GROUPS), 1:1 с
// каталогами app/api/v1/*. Отдельный файл без server-only импортов — эти
// же константы нужны и клиентскому ApiKeys.tsx (чекбоксы формы создания
// ключа), а lib/apikey.ts тянет за собой createAdminClient (service-role),
// который в клиентский бандл попадать не должен.
export type ApiScope = "campaigns" | "templates" | "subscribers" | "automations";

export const API_SCOPES: { id: ApiScope; label: string }[] = [
  { id: "campaigns", label: "Рассылки" },
  { id: "templates", label: "Шаблоны" },
  { id: "subscribers", label: "Подписчики" },
  { id: "automations", label: "Автоматизации" },
];
