// Tiny className combiner — filters falsy values and joins.
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
