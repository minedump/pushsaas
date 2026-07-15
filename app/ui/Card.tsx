import { cn } from "./cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-surface border border-border rounded-xl p-5", className)} {...props} />;
}
