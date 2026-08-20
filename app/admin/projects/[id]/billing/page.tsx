import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BillingClient from "./BillingClient";

export default async function BillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, tariff_id, tariff_pushes_remaining, package_pushes_remaining, remaining_pushes, current_period_end, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const { data: tariffs } = await supabase
    .from("tariffs")
    .select("id, name, price_rub, monthly_push_limit, subscriber_limit, is_public")
    .eq("is_public", true)
    .order("sort");

  const current = tariffs?.find((t) => t.id === project.tariff_id) || null;

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Биллинг</h1>
      <BillingClient
        project={project}
        tariffs={tariffs ?? []}
        currentName={current?.name ?? "—"}
        currentIsPaid={(current?.price_rub ?? 0) > 0}
        publicId={process.env.NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID ?? ""}
      />
    </main>
  );
}
