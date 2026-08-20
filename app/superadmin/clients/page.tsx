import { createClient } from "@/lib/supabase/server";
import ClientsTable from "./ClientsTable";

export default async function ClientsPage() {
  const supabase = await createClient();

  // admin RLS -> sees all rows
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, domain, is_active, owner_id, tariff_id, tariff_pushes_remaining, package_pushes_remaining, remaining_pushes, created_at")
    .order("created_at", { ascending: false });

  const { data: tariffs } = await supabase
    .from("tariffs")
    .select("id, name, price_rub, monthly_push_limit")
    .order("sort");

  // resolve owner emails
  const ownerIds = [...new Set((projects ?? []).map((p) => p.owner_id).filter(Boolean))] as string[];
  const { data: owners } = ownerIds.length
    ? await supabase.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((owners ?? []).map((o) => [o.id, o.email]));

  // active subscriber counts per project
  const { data: subs } = await supabase.from("subscribers").select("project_id").eq("is_active", true).limit(10000);
  const subCount = new Map<string, number>();
  (subs ?? []).forEach((s) => subCount.set(s.project_id, (subCount.get(s.project_id) || 0) + 1));

  const rows = (projects ?? []).map((p) => ({
    ...p,
    owner_email: p.owner_id ? emailById.get(p.owner_id) ?? "—" : "—",
    subscribers: subCount.get(p.id) || 0,
    tariff_name: tariffs?.find((t) => t.id === p.tariff_id)?.name ?? "—",
  }));

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Клиенты</h1>
      <p className="text-ink-muted mt-0">Все проекты платформы — {rows.length}</p>
      <ClientsTable rows={rows} tariffs={tariffs ?? []} />
    </main>
  );
}
