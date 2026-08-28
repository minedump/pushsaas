import { notFound } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { ButtonLink, Card } from "@/app/ui";
import SubscribersTable, { type Row } from "./SubscribersTable";
import ExportImport from "./ExportImport";

export default async function SubscribersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: subs } = await supabase
    .from("subscribers")
    .select("id, platform, is_active, created_at")
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

  // телефон/email/имя/внешний ID/теги/активность SMS+Email привязанной
  // identity (identity_devices → identities) — всё на identity, не на самом
  // subscriber-устройстве: телефон/email/теги не привязаны к конкретному
  // браузеру (см. миграцию 0037 — теги переехали на identities).
  // "Активен" для SMS/Email = *_marketing_active_at, НЕ *_verified_at:
  // подтверждение кодом доказывает владение номером для входа, а не согласие
  // на маркетинговые рассылки — канал становится активным только явно, через
  // /api/v1/subscribers или чекбокс при импорте CSV (см. lib/identity.upsertContact).
  const phoneBySub = new Map<string, string>();
  const emailBySub = new Map<string, string>();
  const nameBySub = new Map<string, string>();
  const insalesClientIdBySub = new Map<string, string>();
  const tagsBySub = new Map<string, string[]>();
  const smsActiveBySub = new Set<string>();
  const emailActiveBySub = new Set<string>();
  const identityIdBySub = new Map<string, string>();
  if (base.length) {
    const { data: links } = await supabase
      .from("identity_devices")
      .select("subscriber_id, identities!inner(id, phone, email, name, insales_client_id, tags, sms_marketing_active_at, email_marketing_active_at)")
      .in(
        "subscriber_id",
        base.map((r) => r.id)
      );
    for (const l of links ?? []) {
      const ident = l.identities as unknown as {
        id: string;
        phone: string | null;
        email: string | null;
        name: string | null;
        insales_client_id: string | null;
        tags: string[] | null;
        sms_marketing_active_at: string | null;
        email_marketing_active_at: string | null;
      };
      if (ident?.id) identityIdBySub.set(l.subscriber_id, ident.id);
      if (ident?.phone) phoneBySub.set(l.subscriber_id, ident.phone);
      if (ident?.email) emailBySub.set(l.subscriber_id, ident.email);
      if (ident?.name) nameBySub.set(l.subscriber_id, ident.name);
      if (ident?.insales_client_id) insalesClientIdBySub.set(l.subscriber_id, ident.insales_client_id);
      if (ident?.tags) tagsBySub.set(l.subscriber_id, ident.tags);
      if (ident?.sms_marketing_active_at) smsActiveBySub.add(l.subscriber_id);
      if (ident?.email_marketing_active_at) emailActiveBySub.add(l.subscriber_id);
    }
  }

  // Один подписчик — одна строка, даже если у него несколько push-устройств
  // (телефон + десктоп): устройства схлопываются в r.devices, каждое со
  // своим platform/is_active/paused (см. SubscribersTable — платформы
  // рендерятся отдельными бейджами со своим статусом). Устройства БЕЗ
  // привязанной identity (никто не подписывался через код) остаются
  // отдельными строками — их не с кем группировать.
  const byIdentity = new Map<string, Row>();
  const anonymousRows: Row[] = [];
  for (const r of base) {
    const identityId = identityIdBySub.get(r.id) ?? null;
    const device = { id: r.id, platform: r.platform, is_active: r.is_active, paused: pausedIds.has(r.id) };
    if (!identityId) {
      anonymousRows.push({
        id: r.id,
        devices: [device],
        tags: [],
        created_at: r.created_at,
        phone: null,
        email: null,
        name: null,
        insalesClientId: null,
        smsActive: false,
        emailActive: false,
        identityId: null,
      });
      continue;
    }
    const existing = byIdentity.get(identityId);
    if (existing) {
      existing.devices.push(device);
      if (new Date(r.created_at) < new Date(existing.created_at)) existing.created_at = r.created_at;
    } else {
      byIdentity.set(identityId, {
        id: `identity-${identityId}`,
        devices: [device],
        tags: tagsBySub.get(r.id) ?? [],
        created_at: r.created_at,
        phone: phoneBySub.get(r.id) ?? null,
        email: emailBySub.get(r.id) ?? null,
        name: nameBySub.get(r.id) ?? null,
        insalesClientId: insalesClientIdBySub.get(r.id) ?? null,
        smsActive: smsActiveBySub.has(r.id),
        emailActive: emailActiveBySub.has(r.id),
        identityId,
      });
    }
  }

  // Контакты без НИ ОДНОГО push-устройства — добавленные вручную («Добавить
  // подписчика») или пришедшие через /api/v1/subscribers/CSV-импорт без своей
  // подписки. Основная выборка выше идёт от subscribers и в принципе не
  // видит identities без устройства — досчитываем отдельно: все identities
  // проекта минус те, что уже встретились через identity_devices.
  const { data: allIdentities } = await supabase
    .from("identities")
    .select("id, phone, email, name, insales_client_id, tags, sms_marketing_active_at, email_marketing_active_at, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1000);
  const devicelessRows: Row[] = [];
  if (allIdentities?.length) {
    const { data: deviceLinks } = await supabase
      .from("identity_devices")
      .select("identity_id")
      .in(
        "identity_id",
        allIdentities.map((i) => i.id)
      );
    const withDevice = new Set((deviceLinks ?? []).map((l) => l.identity_id));
    for (const i of allIdentities) {
      if (withDevice.has(i.id)) continue;
      devicelessRows.push({
        id: `identity-${i.id}`,
        devices: [],
        tags: i.tags ?? [],
        created_at: i.created_at,
        phone: i.phone,
        email: i.email,
        name: i.name,
        insalesClientId: i.insales_client_id,
        smsActive: !!i.sms_marketing_active_at,
        emailActive: !!i.email_marketing_active_at,
        identityId: i.id,
      });
    }
  }

  const rows = [...byIdentity.values(), ...anonymousRows, ...devicelessRows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Подписчики</h1>
        <div className="flex items-center gap-2">
          <ButtonLink href={`/admin/projects/${id}/subscribers/new`}>
            <IconPlus size={16} stroke={2} />
            Новый подписчик
          </ButtonLink>
          <ExportImport projectId={id} />
        </div>
      </div>

      <div className="mt-7">
        {rows.length === 0 ? (
          <Card className="text-ink-muted">
            Пока нет подписчиков. Они появятся, когда посетители нажмут кнопку «🔔 Уведомления» на сайте, или
            добавьте контакт вручную.
          </Card>
        ) : (
          <SubscribersTable projectId={id} initial={rows} />
        )}
      </div>
    </main>
  );
}
