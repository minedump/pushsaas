// Единый формат даты и времени в бэкофисе. Часовой пояс задаём явно (по
// умолчанию Москва, как у настройки проекта): без него сервер при
// отрисовке берёт UTC, браузер — местный пояс, и одно и то же время в
// разных местах разъезжается на несколько часов.
export const DEFAULT_TZ = "Europe/Moscow";

function safeTz(tz?: string | null): string {
  const t = tz || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: t });
    return t;
  } catch {
    return DEFAULT_TZ;
  }
}

export function formatDateTime(d: string | number | Date, tz?: string | null): string {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: safeTz(tz) });
}

export function formatDate(d: string | number | Date, tz?: string | null): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: safeTz(tz) });
}
