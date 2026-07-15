import { createClient } from "@/lib/supabase/server";
import TariffsManager from "./TariffsManager";

export default async function TariffsPage() {
  const supabase = await createClient();
  const { data: tariffs } = await supabase
    .from("tariffs")
    .select("id, name, price_rub, monthly_push_limit, subscriber_limit, is_public, is_system, sort")
    .order("sort");

  return (
    <main className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">Тарифы</h1>
      <p className="text-ink-muted mt-0">
        Глобальный каталог. Списание — за отправленный пуш; лимит тарифа = пушей на месяц.
      </p>
      <TariffsManager initial={tariffs ?? []} />
    </main>
  );
}
