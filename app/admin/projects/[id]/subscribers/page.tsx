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

  // телефоны и email привязанных устройств (identity_devices → identities)
  const phoneBySub = new Map<string, string>();
  const emailBySub = new Map<string, string>();
  if (base.length) {
    const { data: links } = await supabase
      .from("identity_devices")
      .select("subscriber_id, identities!inner(phone, email)")
      .in(
        "subscriber_id",
        base.map((r) => r.id)
      );
    for (const l of links ?? []) {
      const ident = l.identities as unknown as { phone: string; email: string | null };
      if (ident?.phone) phoneBySub.set(l.subscriber_id, ident.phone);
      if (ident?.email) emailBySub.set(l.subscriber_id, ident.email);
    }
  }

  // best-effort: внешний идентификатор из subscribers.attributes (миграция
  // 0008) — отдельный запрос, отсутствие колонки не роняет список.
  const externalBySub = new Map<string, string>();
  if (base.length) {
    const { data: attrRows, error: attrErr } = await supabase
      .from("subscribers")
      .select("id, attributes")
      .eq("project_id", id)
      .in(
        "id",
        base.map((r) => r.id)
      );
    if (!attrErr) {
      for (const r of attrRows ?? []) {
        const a = (r.attributes || {}) as Record<string, unknown>;
        const ext = a.external_id ?? a.externalId;
        if (ext != null && ext !== "") externalBySub.set(r.id, String(ext));
      }
    }
  }

  const rows = base.map((r) => ({
    ...r,
    paused: pausedIds.has(r.id),
    phone: phoneBySub.get(r.id) ?? null,
    email: emailBySub.get(r.id) ?? null,
    externalId: externalBySub.get(r.id) ?? null,
  }));
  const active = rows.filter((r) => r.is_active);
  const byPlatform = active.reduce<Record<string, number>>((acc, r) => {
    acc[r.platform] = (acc[r.platform] || 0) + 1;
    return acc;
  }, {});

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">{project.name} · Подписчики</h1>
        <ExportImport projectId={id} />
      </div>

      <div className="flex gap-3 mt-5 flex-wrap">
        <Tile label="Всего активных" value={active.length} />
        <Tile label="iPhone (iOS)" value={byPlatform.ios || 0} />
        <Tile label="Android" value={byPlatform.android || 0} />
        <Tile label="Desktop" value={byPlatform.desktop || 0} />
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

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex-1 min-w-[150px]">
      <div className="text-ink-muted text-xs">{label}</div>
      <div className="text-[26px] font-bold">{value}</div>
    </Card>
  );
}
