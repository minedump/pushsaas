import { IconTrash } from "@tabler/icons-react";
import { cn } from "./cn";

// Три смысловых представления кнопки: первостепенная (primary) — главное
// действие, второстепенная (secondary) — вспомогательное, удаления (danger) —
// деструктивное. У danger своя фиксированная айдентика (красная заливка+
// обводка, иконка корзины) — вшита сюда, а не собирается заново в каждом
// месте использования: раньше кто-то добавлял <IconTrash> вручную, кто-то
// нет, у кого-то была бледная обводка вместо заливки — теперь одно место
// правды. ghost — отдельный лёгкий вариант для некритичных вспомогательных
// кнопок (не входит в «три представления», но используется в паре мест).
type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white border border-accent hover:opacity-90",
  secondary: "bg-surface text-ink border border-border hover:bg-surface-2",
  danger: "bg-bad-solid text-white border border-bad-solid hover:opacity-90",
  ghost: "bg-transparent text-ink-muted border border-transparent hover:bg-surface-2",
};
const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs rounded-md gap-1.5",
  md: "px-4 py-2 text-sm rounded-lg gap-2",
};
const dangerIconSize: Record<Size, number> = { sm: 14, md: 16 };

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap font-semibold cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {variant === "danger" && <IconTrash size={dangerIconSize[size]} stroke={1.8} className="shrink-0" />}
      {children}
    </button>
  );
}

// Anchor styled as a button (for navigation links).
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap font-semibold cursor-pointer transition-opacity no-underline",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}
