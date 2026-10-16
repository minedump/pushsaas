import { signParam, verifyParam } from "@/lib/oidc";

// Предпросмотр виджета на реальном сайте клиента (кнопка «Посмотреть на сайте»
// в разделе «Виджеты»). Админка выдаёт подписанный токен, его дописывают к
// адресу страницы сайта: ?sendera_preview=<токен>. Основной скрипт, увидев
// параметр, подгружает отдельный /embed/{projectId}/preview.js, а тот отдаёт
// код ТОЛЬКО указанного виджета — даже если он выключен в настройках. Так
// выключенные виджеты по-прежнему не попадают в публичную выдачу, а показать
// их по чужой ссылке нельзя: нужна подпись, привязанная к проекту, виджету
// и сроку.
export const PREVIEW_WIDGETS = ["button", "prompt", "install"] as const;
export type PreviewWidget = (typeof PREVIEW_WIDGETS)[number];

export const PREVIEW_PARAM = "sendera_preview";
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

function payload(projectId: string, widget: PreviewWidget, exp: number) {
  return `wprev:${projectId}:${widget}:${exp}`;
}

// Токен: <виджет>.<срок, мс от эпохи>.<подпись> — только буквы, цифры и точки,
// в адрес вставляется без экранирования.
export function makePreviewToken(projectId: string, widget: PreviewWidget, now = Date.now()) {
  const exp = now + PREVIEW_TTL_MS;
  return { token: `${widget}.${exp}.${signParam(payload(projectId, widget, exp))}`, expiresAt: exp };
}

// Возвращает виджет, если токен подлинный, выдан для этого проекта и не истёк.
export function readPreviewToken(projectId: string, token: string | null | undefined, now = Date.now()): PreviewWidget | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [widget, expRaw, sig] = parts;
  if (!(PREVIEW_WIDGETS as readonly string[]).includes(widget)) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now) return null;
  return verifyParam(payload(projectId, widget as PreviewWidget, exp), sig) ? (widget as PreviewWidget) : null;
}
