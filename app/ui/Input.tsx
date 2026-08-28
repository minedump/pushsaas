import { IconLock } from "@tabler/icons-react";
import { cn } from "./cn";

const base =
  "w-full text-sm px-3 py-2 rounded-lg border border-border bg-surface text-ink " +
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

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  // textarea — inline-replaced по умолчанию, из-за этого снизу остаётся
  // паразитная полоска (baseline-выравнивание, та же природа, что и у
  // <img>) — block её убирает.
  return <textarea className={cn(base, "resize-y block", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-xs text-ink-muted mb-1.5", className)} {...props} />;
}
