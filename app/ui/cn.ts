// Tiny className combiner — filters falsy values and joins. Also resolves
// conflicting bare `w-*` utilities (e.g. a component's own default `w-full`
// vs. a caller's `className="w-20"`): CSS cascade order for two equal-
// specificity classes depends on Tailwind's generated stylesheet order, NOT
// on their order in the class string, so without this a later explicit
// width can silently lose to an earlier default (see Input's `base` +
// caller override). Last `w-*` token wins; `sm:w-1/2`, `min-w-*`, `max-w-*`
// etc. don't match the prefix and are left alone.
export function cn(...parts: (string | false | null | undefined)[]): string {
  const tokens = parts.filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
  const result: string[] = [];
  for (const t of tokens) {
    if (/^w-/.test(t)) {
      for (let i = result.length - 1; i >= 0; i--) {
        if (/^w-/.test(result[i])) result.splice(i, 1);
      }
    }
    result.push(t);
  }
  return result.join(" ");
}
