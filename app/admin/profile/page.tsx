import { createClient } from "@/lib/supabase/server";
import { Badge, Card } from "@/app/ui";
import ChangePassword from "./ChangePassword";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();

  return (
    <main className="max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold">Профиль</h1>

      <Card className="mt-4">
        <div className="text-xs text-ink-muted mb-1.5">Email</div>
        <div className="text-[15px]">{user?.email}</div>
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
