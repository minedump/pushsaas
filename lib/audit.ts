import { createAdminClient } from "@/lib/supabase/admin";

// Явная запись в журнал действий для того, что не оставляет строки в
// таблице с триггером (отправка кампании, экспорт, массовые операции).
// Автор берётся из auditAs() — вызывать после него. Best-effort: сбой
// журнала не должен ронять само действие.
export async function writeAudit(e: {
  projectId: string;
  entity: string;
  entityId?: string | null;
  name?: string | null;
  action: string;
  changes?: Record<string, unknown> | null;
}) {
  try {
    await createAdminClient().rpc("audit_event", {
      p_project: e.projectId,
      p_entity: e.entity,
      p_entity_id: e.entityId ?? null,
      p_name: e.name ?? null,
      p_action: e.action,
      p_changes: e.changes ?? null,
    });
  } catch {
    // журнал вторичен
  }
}
