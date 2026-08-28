import { cn } from "./cn";

// Единый переключатель периода/режима на несколько кнопок в ряд (Сегодня/
// Неделя/Месяц и т.п.) — раньше был продублирован инлайново в дашборде и в
// аналитике с разным контрастом активного элемента; теперь один источник
// правды с явным акцентом на активной кнопке (сплошная заливка, а не бледный
// тинт, который терялся на фоне самого переключателя).
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-1 p-1 rounded-lg bg-surface-2 border border-border", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 h-7 shrink-0 rounded-md text-[13px] font-medium cursor-pointer transition-colors",
            o.value === value ? "bg-accent text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
