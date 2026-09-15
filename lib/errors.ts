// Наши собственные RPC/триггеры кидают исключения уже на русском (см.
// `raise exception` в supabase/migrations) — их можно показывать как есть.
// Всё остальное (сырые ошибки Postgres/PostgREST, сетевые сбои) — на английском
// или в техническом формате, который не должен долетать до пользователя.
type ErrorLike = { message?: string | null; code?: string | null } | null | undefined;

const KNOWN_CODES: Record<string, string> = {
  "23505": "Такая запись уже существует",
  "23503": "Действие невозможно: запись используется в другом месте",
  "42501": "Недостаточно прав для этого действия",
  "23514": "Значение не проходит проверку",
  PGRST301: "Сессия истекла — обновите страницу и войдите заново",

  // Supabase Auth (GoTrue) — коды из error.code, см. app/login/page.tsx.
  // Сообщения самого GoTrue всегда на английском, свой код показывать нельзя.
  invalid_credentials: "Неверный email или пароль",
  user_already_exists: "Пользователь с таким email уже зарегистрирован",
  email_exists: "Пользователь с таким email уже зарегистрирован",
  user_not_found: "Пользователь с таким email не найден",
  email_not_confirmed: "Email не подтверждён",
  weak_password: "Пароль слишком простой — минимум 6 символов",
  same_password: "Новый пароль совпадает со старым",
  validation_failed: "Проверьте правильность email",
  email_address_invalid: "Некорректный формат email",
  over_email_send_rate_limit: "Слишком много попыток — подождите немного и повторите",
  over_request_rate_limit: "Слишком много попыток — подождите немного и повторите",
  signup_disabled: "Регистрация временно недоступна",
};

function hasCyrillic(s: string): boolean {
  return /[а-яё]/i.test(s);
}

export function friendlyError(
  error: ErrorLike,
  fallback = "Не удалось выполнить действие. Попробуйте ещё раз."
): string {
  if (!error) return fallback;
  if (error.code && KNOWN_CODES[error.code]) return KNOWN_CODES[error.code];
  if (error.message && hasCyrillic(error.message)) return error.message;
  return fallback;
}
