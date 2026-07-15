// Flattens a nested object/array into dot-keyed pairs so any field of an
// incoming webhook body is usable as a {dot.key} template placeholder.
// e.g. { client: { phone: "…" }, fields: [{ name: "x" }] }
//   -> { "client.phone": "…", "fields.0.name": "x" }
export function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || typeof obj !== "object") {
    if (prefix) out[prefix] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
