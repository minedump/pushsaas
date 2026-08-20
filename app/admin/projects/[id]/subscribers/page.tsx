import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { Card } from "@/app/ui";
import SubscribersTable from "./SubscribersTable";
import ExportImport from "./ExportImport";

export default async function SubscribersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: subs } = await supabase
    .from("subscribers")
    .select("id, platform, tags, is_active, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1000);

  const base = subs ?? [];

  // best-effort: paused — отдельный запрос, чтобы отсутствующая колонка (до
  // миграции 0009) не роняла основной список подписчиков целиком.
  const pausedIds = new Set<string>();
  if (base.length) {
    const { data: pausedRows, error: pausedErr } = await supabase
      .from("subscribers")
      .select("id")
      .eq("project_id", id)
      .eq("paused", true);
    if (!pausedErr) for (const r of pausedRows ?? []) pausedIds.add(r.id);
  }

  // телефон/email/имя/внешний ID/активность SMS+Email привязанной identity
  // (identity_devices → identities) — всё на identity, не на самом
  // subscriber-устройстве: телефон/email не привязаны к конкретному браузеру.
  // "Активен" для SMS/Email = *_marketing_active_at, НЕ *_verified_at:
  // подтверждение кодом доказывает владение номером для входа, а не согласие
  // на маркетинговые рассылки — канал становится активным только явно, через
  // /api/v1/contacts или чекбокс при импорте CSV (см. lib/identity.upsertContact).
  const phoneBySub = new Map<string, string>();
  const emailBySub = new Map<string, string>();
  const nameBySub = new Map<string, string>();
  const insalesClientIdBySub = new Map<string, string>();
  const smsActiveBySub = new Set<string>();
  const emailActiveBySub = new Set<string>();
  if (base.length) {
    const { data: links } = await supabase
      .from("identity_devices")
      .select("subscriber_id, identities!inner(phone, email, name, insales_client_id, sms_marketing_active_at, email_marketing_active_at)")
      .in(
        "subscriber_id",
        base.map((r) => r.id)
      );
    for (const l of links ?? []) {
      const ident = l.identities as unknown as {
        phone: string | null;
        email: string | null;
        name: string | null;
        insales_client_id: string | null;
        sms_marketing_active_at: string | null;
        email_marketing_active_at: string | null;
      };
      if (ident?.phone) phoneBySub.set(l.subscriber_id, ident.phone);
      if (ident?.email) emailBySub.set(l.subscriber_id, ident.email);
      if (ident?.name) nameBySub.set(l.subscriber_id, ident.name);
      if (ident?.insales_client_id) insalesClientIdBySub.set(l.subscriber_id, ident.insales_client_id);
      if (ident?.sms_marketing_active_at) smsActiveBySub.add(l.subscriber_id);
      if (ident?.email_marketing_active_at) emailActiveBySub.add(l.subscriber_id);
    }
  }

  const rows = base.map((r) => ({
    ...r,
    paused: pausedIds.has(r.id),
    phone: phoneBySub.get(r.id) ?? null,
    email: emailBySub.get(r.id) ?? null,
    name: nameBySub.get(r.id) ?? null,
    insalesClientId: insalesClientIdBySub.get(r.id) ?? null,
    pushActive: r.is_active && !pausedIds.has(r.id),
    smsActive: smsActiveBySub.has(r.id),
    emailActive: emailActiveBySub.has(r.id),
  }));

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Подписчики</h1>
        <ExportImport projectId={id} />
      </div>

      <div className="mt-7">
        {rows.length === 0 ? (
          <Card className="text-ink-muted">
            Пока нет подписчиков. Они появятся, когда посетители нажмут кнопку «🔔 Уведомления» на сайте.
          </Card>
        ) : (
          <SubscribersTable projectId={id} initial={rows} />
        )}
      </div>
    </main>
  );
}
