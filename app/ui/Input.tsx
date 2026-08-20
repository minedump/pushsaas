import { cn } from "./cn";

const base =
  "w-full text-sm px-3 py-2 rounded-lg border border-border bg-surface text-ink " +
  "placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent-line focus:ring-offset-0";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
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
