import { IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { Badge, ButtonLink, Card } from "@/app/ui";

export default async function AdminHome() {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, domain, is_active")
    .order("created_at", { ascending: false });

  return (
    <main className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Мои проекты</h1>
        <ButtonLink href="/admin/projects/new">
          <IconPlus size={18} stroke={2} />
          Создать проект
        </ButtonLink>
      </div>

      <div className="mt-4 sm:mt-8">
        {!projects?.length && (
          <Card className="mt-3 text-ink-muted">Пока нет проектов. Нажмите «Создать проект», чтобы начать собирать подписчиков.</Card>
        )}

        {projects?.map((p) => (
          <a key={p.id} href={`/admin/projects/${p.id}`} className="block no-underline text-inherit">
            <Card className="mt-3 flex justify-between items-start hover:border-accent transition-colors">
              <div className="flex flex-col gap-1.5">
                <strong className="text-[15px] leading-5">{p.name}</strong>
                <div className="text-ink-faint text-[13px] leading-4">{p.domain}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Badge tone={p.is_active ? "good" : "bad"} dot>
                  {p.is_active ? "активен" : "заблокирован"}
                </Badge>
              </div>
            </Card>
          </a>
        ))}
      </div>
    </main>
  );
}
