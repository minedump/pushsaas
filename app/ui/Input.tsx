"use client";

import { useState } from "react";
import { IconLock, IconEye, IconEyeOff, IconInfoCircle } from "@tabler/icons-react";
import { cn } from "./cn";

const base =
  "w-full text-sm px-3 py-2 rounded-xl border border-border bg-surface text-ink " +
  "placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-line focus:ring-offset-0 " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

// Заблокированный инпут получает иконку замка автоматически — раньше её
// добавляли вручную в паре мест (не везде одинаково), теперь один источник
// правды: любой disabled-инпут в проекте выглядит одинаково без лишних
// пропсов у вызывающего кода.
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  if (props.disabled) {
    return (
      <div className={cn("relative", className)}>
        <input className={cn(base, "w-full pr-9")} {...props} />
        <IconLock size={16} stroke={1.8} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
      </div>
    );
  }
  return <input className={cn(base, className)} {...props} />;
}

// Пароль со своим глазиком — раньше собирался вручную в ChangePassword.tsx
// (дважды, под каждое поле, с общим состоянием видимости) — теперь один
// источник правды, видимость держит сама у себя, каждому полю своя.
export function PasswordInput({ className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-9", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-ink-faint hover:text-ink transition-colors cursor-pointer"
        title={visible ? "Скрыть пароль" : "Показать пароль"}
      >
        {visible ? <IconEyeOff size={16} stroke={1.8} /> : <IconEye size={16} stroke={1.8} />}
      </button>
    </div>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  // textarea — inline-replaced по умолчанию, из-за этого снизу остаётся
  // паразитная полоска (baseline-выравнивание, та же природа, что и у
  // <img>) — block её убирает.
  return <textarea className={cn(base, "resize-y block", className)} {...props} />;
}

// tip — необязательная подсказка-термин рядом с подписью поля (значок +
// TooltipHost, см. app/ui/Tooltip.tsx: элементу достаточно data-tip).
// Без tip — прежний однострочный блочный лейбл, ничего не меняется у
// существующих мест использования.
export function Label({
  className,
  tip,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { tip?: string }) {
  if (!tip) {
    return (
      <label className={cn("block text-xs text-ink-muted mb-1.5", className)} {...props}>
        {children}
      </label>
    );
  }
  return (
    <label className={cn("flex items-center gap-1.5 text-xs text-ink-muted mb-1.5", className)} {...props}>
      {children}
      <button
        type="button"
        aria-label="Подробнее"
        data-tip={tip}
        className="inline-flex text-ink-faint hover:text-ink transition-colors cursor-pointer"
      >
        <IconInfoCircle size={14} stroke={1.8} />
      </button>
    </label>
  );
}
