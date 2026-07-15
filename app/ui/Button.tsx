import { cn } from "./cn";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white border border-accent hover:opacity-90",
  secondary: "bg-surface text-ink border border-border hover:bg-surface-2",
  danger: "bg-transparent text-bad border border-border hover:bg-bad-tint",
  ghost: "bg-transparent text-ink-muted border border-transparent hover:bg-surface-2",
};
const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs rounded-md gap-1.5",
  md: "px-4 py-2.5 text-sm rounded-lg gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-semibold cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
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
        "inline-flex items-center justify-center font-semibold cursor-pointer transition-opacity no-underline",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}
