import { IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card } from "@/app/ui";

export default async function AdminHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
  const isAdmin = profile?.role === "admin";

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, domain, is_active, remaining_pushes")
    .order("created_at", { ascending: false });

  return (
    <main className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">Панель управления</h1>
      <p className="text-ink-muted">Вошёл как {user?.email}</p>

      <div className="mt-7">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-semibold">{isAdmin ? "Проекты платформы" : "Мои проекты"}</h2>
          {!isAdmin && (
            <ButtonLink href="/admin/projects/new" size="sm">
              <IconPlus size={16} stroke={2} />
              Создать проект
            </ButtonLink>
          )}
        </div>

        {!projects?.length && (
          <Card className="mt-3 text-ink-muted">
            {isAdmin
              ? "На платформе пока нет проектов."
              : "Пока нет проектов. Нажмите «Создать проект», чтобы начать собирать подписчиков."}
          </Card>
        )}

        {projects?.map((p) => (
          <a key={p.id} href={`/admin/projects/${p.id}`} className="block no-underline text-inherit">
            <Card className="mt-3 flex justify-between hover:border-accent transition-colors">
              <div>
                <strong>{p.name}</strong>
                <div className="text-ink-faint text-[13px]">{p.domain}</div>
              </div>
              <div className="text-right">
                <Badge tone={p.is_active ? "good" : "bad"} dot>
                  {p.is_active ? "активен" : "заблокирован"}
                </Badge>
                <div className="text-[13px] mt-1.5">{p.remaining_pushes} пушей</div>
              </div>
            </Card>
          </a>
        ))}
      </div>
    </main>
  );
}
