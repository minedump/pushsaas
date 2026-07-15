import { cn } from "./cn";

type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

const tones: Record<Tone, string> = {
  good: "bg-good-tint text-good",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
  neutral: "bg-surface-2 text-ink-muted",
  accent: "bg-accent-tint text-accent",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap",
        tones[tone],
        className
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
      {children}
    </span>
  );
}
