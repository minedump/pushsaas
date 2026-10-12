import { AsyncLocalStorage } from "node:async_hooks";

// Автор запроса для журнала действий (audit_log, миграция 0103). Серверные
// роуты ходят в БД service-ключом, под которым БД не знает, кто из людей
// нажал кнопку, — поэтому роут один раз после проверки доступа вызывает
// auditAs(user.id), а createAdminClient() подмешивает автора заголовками
// x-audit-actor / x-audit-source (триггеры верят им только для service_role).
// Вызывать надо синхронно в теле самого роута: enterWith внутри awaited-хелпера
// на вызывающий код не распространяется.
type AuditStore = { actor?: string; source: string };
const store = new AsyncLocalStorage<AuditStore>();

export function auditAs(actor: string | null | undefined, source = "ui") {
  store.enterWith({ actor: actor || undefined, source });
}

export function currentAudit(): AuditStore | undefined {
  return store.getStore();
}
