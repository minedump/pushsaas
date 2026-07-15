// Resolve a value from a JSON object by a configurable path.
// Supports:  a.b.c          — nested keys
//            arr[0]         — array index
//            arr[key=value] — find array element where element[key] == value
// A leading "order." is stripped (the webhook body IS the order).
// Example: "fields[name=Трек-номер].value"
export function resolvePath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  const clean = path.replace(/^order\./, "");
  let cur: unknown = root;

  for (const seg of clean.split(".").filter(Boolean)) {
    if (cur == null) return undefined;
    const m = seg.match(/^(\w+)?(?:\[(.+)\])?$/);
    if (!m) return undefined;

    const key = m[1];
    if (key) cur = (cur as Record<string, unknown>)[key];

    const filter = m[2];
    if (filter != null) {
      if (!Array.isArray(cur)) return undefined;
      if (/^\d+$/.test(filter)) {
        cur = cur[Number(filter)];
      } else {
        const eq = filter.indexOf("=");
        const fk = filter.slice(0, eq);
        const fv = filter.slice(eq + 1);
        cur = cur.find((el) => el && String((el as Record<string, unknown>)[fk]) === fv);
      }
    }
  }
  return cur;
}
