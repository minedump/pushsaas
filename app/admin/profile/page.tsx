import { createClient } from "@/lib/supabase/server";
import { Badge, Card } from "@/app/ui";
import ChangePassword from "./ChangePassword";
import EditName from "./EditName";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role, full_name").eq("id", user!.id).maybeSingle();

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Профиль</h1>

      <h2 className="text-base font-semibold mt-8">Личные данные</h2>
      <Card className="mt-3">
        <EditName initialName={profile?.full_name ?? null} email={user?.email ?? ""} />
        <div className="text-xs text-ink-muted mb-1.5 mt-4">Роль</div>
        <Badge tone={profile?.role === "admin" ? "warn" : "good"} dot>
          {profile?.role === "admin" ? "суперадмин" : "клиент"}
        </Badge>
      </Card>

      <h2 className="text-base font-semibold mt-8">Сменить пароль</h2>
      <ChangePassword />
    </main>
  );
}
