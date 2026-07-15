import { resolvePath } from "@/lib/jsonpath";

// Replaces {key} placeholders with values from `data` (event attributes,
// order fields, etc.). Unknown/empty placeholders render as "".
export function applyTemplate(str: string | null | undefined, data: Record<string, unknown> = {}): string {
  if (!str) return "";
  return str.replace(/\{([\w.]+)\}/g, (_, k: string) => {
    const v = data[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

// Like applyTemplate but resolves each {path} against a root object using the
// full path syntax (nested + array find-by-name), so a webhook payload field
// can be referenced directly in the message, e.g. {fields[name=Трек].value}.
// `extra` (named vars) takes precedence when a key is explicitly provided.
export function applyTemplatePaths(
  str: string | null | undefined,
  root: unknown,
  extra: Record<string, unknown> = {}
): string {
  if (!str) return "";
  return str.replace(/\{([^{}]+)\}/g, (_, raw: string) => {
    const key = raw.trim();
    const v = key in extra ? extra[key] : resolvePath(root, key);
    return v === undefined || v === null ? "" : String(v);
  });
}
