// Виджет «Установка приложения» — всплывающее окно с пошаговой инструкцией,
// как добавить сайт на экран телефона (отдельные шаги для iPhone и Android).
// Сам виджет кнопок открытия не рисует: окно открывает код сайта методами
// sendera.openInstallGuide*() (см. installBlock в lib/widget-scripts.ts).
// Живёт в projects.widget_config.install рядом с button и prompt. Типы и
// резолвер — общие для настроек (перед записью), скрипта (при чтении) и
// предпросмотра в админке, поэтому модуль не содержит серверных зависимостей.

import type { CornerRadius } from "@/lib/widget-config";

export type InstallPlatform = "ios" | "android";

// scene: "" — без рисунка; id из каталога ниже — схема, которую мы рисуем сами
// (см. lib/install-scenes); "image" — своя картинка из step.image.
export type InstallStep = { text: string; scene: string; image: string };

export type InstallConfig = {
  enabled: boolean;
  title: string;
  intro: string;
  buttonText: string;
  buttonColor: string;
  buttonTextColor: string;
  buttonRadius: CornerRadius;
  ios: InstallStep[];
  android: InstallStep[];
};

export const CUSTOM_IMAGE_SCENE = "image";

// Каталог готовых схем по платформам (порядок = порядок в списке выбора).
export const INSTALL_SCENES: Record<InstallPlatform, { id: string; label: string }[]> = {
  ios: [
    { id: "ios-open", label: "Safari: сайт открыт" },
    { id: "ios-share", label: "Safari: кнопка «Поделиться»" },
    { id: "ios-sheet", label: "Safari: меню «Поделиться»" },
    { id: "ios-home", label: "Экран «Домой»: иконка приложения" },
  ],
  android: [
    { id: "and-open", label: "Chrome: сайт открыт" },
    { id: "and-menu-button", label: "Chrome: кнопка меню" },
    { id: "and-menu", label: "Chrome: меню" },
    { id: "and-shortcut", label: "Chrome: создать ярлык" },
    { id: "and-confirm", label: "Chrome: подтверждение" },
    { id: "and-home", label: "Экран: иконка приложения" },
  ],
};

export const ALL_SCENE_IDS: string[] = [...INSTALL_SCENES.ios, ...INSTALL_SCENES.android].map((s) => s.id);

export const DEFAULT_INSTALL: InstallConfig = {
  enabled: false,
  title: "Установите приложение",
  intro: "Магазин на экране телефона открывается в одно касание, а уведомления о заказах и акциях приходят как из обычного приложения.",
  buttonText: "Понятно",
  buttonColor: "#2c4a66",
  buttonTextColor: "#ffffff",
  buttonRadius: "md",
  ios: [
    { text: "Откройте сайт в **Safari**", scene: "ios-open", image: "" },
    { text: "Нажмите **Поделиться** внизу экрана", scene: "ios-share", image: "" },
    { text: "Выберите **На экран «Домой»**", scene: "ios-sheet", image: "" },
    { text: "Нажмите **Добавить**: иконка появится на экране «Домой»", scene: "ios-home", image: "" },
  ],
  android: [
    { text: "Откройте сайт в **Chrome**", scene: "and-open", image: "" },
    { text: "Нажмите **три точки** в правом верхнем углу", scene: "and-menu-button", image: "" },
    { text: "Выберите **Добавить на гл. экран**", scene: "and-menu", image: "" },
    { text: "Проверьте название и нажмите **Добавить**", scene: "and-shortcut", image: "" },
    { text: "Подтвердите: **Добавить на главный экран**", scene: "and-confirm", image: "" },
    { text: "Готово: иконка появилась на главном экране", scene: "and-home", image: "" },
  ],
};

export const INSTALL_MAX_STEPS = 12;
export const INSTALL_TEXT_MAX = 160;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const RADII: CornerRadius[] = ["none", "sm", "md", "lg"];

// Своя картинка принимается только из хранилища этого же проекта
// (app/api/admin/widget/install-image) — произвольные адреса в конфиг не пускаем.
export function isOwnInstallImage(url: unknown, projectId: string): url is string {
  if (typeof url !== "string" || url.length > 600 || /["'<>\s\\]/.test(url)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return url.includes(`/storage/v1/object/public/project-assets/${projectId}/install/`);
}

function resolveSteps(raw: unknown, platform: InstallPlatform, fallback: InstallStep[], projectId: string): InstallStep[] {
  if (!Array.isArray(raw)) return fallback.map((s) => ({ ...s }));
  const allowed = new Set(INSTALL_SCENES[platform].map((s) => s.id));
  const out: InstallStep[] = [];
  for (const item of raw.slice(0, INSTALL_MAX_STEPS)) {
    const c = (item && typeof item === "object" ? item : {}) as Partial<InstallStep>;
    const text = typeof c.text === "string" ? c.text.trim().slice(0, INSTALL_TEXT_MAX) : "";
    if (!text) continue;
    let scene = typeof c.scene === "string" ? c.scene : "";
    let image = "";
    if (scene === CUSTOM_IMAGE_SCENE) {
      if (isOwnInstallImage(c.image, projectId)) image = c.image;
      else scene = "";
    } else if (!allowed.has(scene)) scene = "";
    out.push({ text, scene, image });
  }
  return out;
}

// projectId нужен только для проверки адресов своих картинок.
export function resolveInstallConfig(raw: unknown, projectId: string): InstallConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<InstallConfig>;
  const str = (v: unknown, fallback: string, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);
  const hex = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback);
  return {
    enabled: c.enabled === true,
    title: str(c.title, DEFAULT_INSTALL.title, 60),
    intro: typeof c.intro === "string" ? c.intro.trim().slice(0, 240) : DEFAULT_INSTALL.intro,
    buttonText: str(c.buttonText, DEFAULT_INSTALL.buttonText, 30),
    buttonColor: hex(c.buttonColor, DEFAULT_INSTALL.buttonColor),
    buttonTextColor: hex(c.buttonTextColor, DEFAULT_INSTALL.buttonTextColor),
    buttonRadius: RADII.includes(c.buttonRadius as CornerRadius) ? (c.buttonRadius as CornerRadius) : DEFAULT_INSTALL.buttonRadius,
    ios: resolveSteps(c.ios, "ios", DEFAULT_INSTALL.ios, projectId),
    android: resolveSteps(c.android, "android", DEFAULT_INSTALL.android, projectId),
  };
}

// Адрес картинки шага для окна и предпросмотра: схему рисует сервер по данным
// проекта (иконка, название, цвет, адрес сайта из манифеста), своя картинка —
// прямая ссылка. version — метка для сброса кэша при перегенерации манифеста.
export function installStepImageUrl(api: string, projectId: string, step: InstallStep, version: string): string {
  if (step.scene === CUSTOM_IMAGE_SCENE) return step.image;
  if (!step.scene) return "";
  return `${api}/api/public/install-scene?p=${encodeURIComponent(projectId)}&s=${encodeURIComponent(step.scene)}&v=${encodeURIComponent(version)}`;
}

// Скругление кнопки «Понятно» (высота 40px) — своя шкала, как у кнопок плашки.
export const INSTALL_BUTTON_RADIUS_PX: Record<CornerRadius, number> = { none: 0, sm: 8, md: 12, lg: 999 };
