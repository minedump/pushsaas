"use client";

import { useDialogs } from "./Dialogs";

// Копирование в буфер с тостом. navigator.clipboard.writeText бывает
// недоступен или запрещён (встроенные окна, фокус не на странице, старые
// браузеры) — тогда пробуем запасной путь через скрытое поле и execCommand.
// Любой исход показывается тостом: молча кнопка не должна ничего делать.
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // уходим на запасной путь
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function useCopy() {
  const { toast } = useDialogs();
  return async function copy(text: string, okMessage = "Скопировано"): Promise<boolean> {
    const ok = await writeClipboard(text);
    if (ok) toast(okMessage, "good");
    else toast("Не удалось скопировать — выделите текст и нажмите Ctrl+C", "bad");
    return ok;
  };
}
