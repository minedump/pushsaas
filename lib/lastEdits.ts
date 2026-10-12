import type { SupabaseClient } from "@supabase/supabase-js";

export type LastEdit = { name: string | null; email: string | null; at: string };

// Кто последним менял объекты проекта — по журналу действий (audit_log).
// Журнал хранится 3 месяца, поэтому у давно не менявшихся объектов записи
// нет — интерфейс показывает «—». Берём только правки человеком (update).
export async function lastEdits(
  supabase: SupabaseClient,
  projectId: string,
  entity: string,
  ids?: string[]
): Promise<Map<string, LastEdit>> {
  let q = supabase
    .from("audit_log")
    .select("entity_id, actor_name, actor_email, created_at")
    .eq("project_id", projectId)
    .eq("entity", entity)
    .eq("action", "update")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (ids) q = q.in("entity_id", ids);
  const { data } = await q;
  const map = new Map<string, LastEdit>();
  for (const r of data ?? []) {
    if (!r.entity_id || map.has(r.entity_id)) continue;
    map.set(r.entity_id, { name: r.actor_name, email: r.actor_email, at: r.created_at });
  }
  return map;
}
