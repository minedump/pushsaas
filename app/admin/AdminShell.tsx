"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  IconBell,
  IconBellRinging,
  IconPlus,
  IconHistory,
  IconLayoutDashboard,
  IconUsers,
  IconSend,
  IconChartBar,
  IconBolt,
  IconCreditCard,
  IconCode,
  IconPhone,
  IconBuildingStore,
  IconTags,
  IconUser,
  IconLogout,
  type TablerIcon,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Select } from "@/app/ui/Select";
import { DialogProvider } from "@/app/ui/Dialogs";
import { cn } from "@/app/ui/cn";

type Project = { id: string; name: string };

export default function AdminShell({
  role,
  projects,
  children,
}: {
  role: string;
  projects: Project[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const isAdmin = role === "admin";
  const currentProjectId = pathname.match(/\/admin\/projects\/([0-9a-f-]{36})/i)?.[1];

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const NavLink = ({ href, label, active, icon: Ico }: { href: string; label: string; active: boolean; icon: TablerIcon }) => (
    <a
      href={href}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap",
        active ? "bg-accent-tint text-accent font-semibold" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      )}
    >
      <Ico size={18} stroke={1.8} className="shrink-0" />
      <span>{label}</span>
    </a>
  );

  const Cap = ({ children }: { children: React.ReactNode }) => (
    <div className="hidden md:block font-mono text-[10px] uppercase tracking-wider text-ink-faint px-3 pt-4 pb-1.5">
      {children}
    </div>
  );

  const p = (s: string) => (currentProjectId ? `/admin/projects/${currentProjectId}${s}` : "#");

  return (
    <DialogProvider>
      <div className="min-h-screen flex flex-col">
        {/* header */}
        <header className="sticky top-0 z-20 h-14 flex items-center gap-4 px-5 border-b border-border bg-surface">
          <a href="/admin" className="flex items-center gap-2 font-bold text-base text-ink whitespace-nowrap no-underline">
            <IconBell size={20} stroke={1.8} className="text-accent" />
            PushSaaS
          </a>
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={currentProjectId || ""}
              onChange={(e) => e.target.value && router.push(`/admin/projects/${e.target.value}`)}
              aria-label="Текущий проект"
              className="max-w-[220px]"
            >
              <option value="" disabled>
                {projects.length ? "Выберите проект" : "Нет проектов"}
              </option>
              {projects.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </Select>
            {!isAdmin && (
              <a
                href="/admin/projects/new"
                title="Создать проект"
                className="grid place-items-center w-9 h-9 rounded-lg border border-border text-ink-muted hover:border-accent hover:text-accent no-underline"
              >
                <IconPlus size={18} stroke={2} />
              </a>
            )}
          </div>
        </header>

        {/* body */}
        <div className="flex flex-1 flex-col md:flex-row">
          <aside className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border bg-surface md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] flex md:flex-col md:justify-between gap-1 p-2 md:p-3 overflow-x-auto">
            <nav className="flex md:flex-col gap-1 items-center md:items-stretch">
              {currentProjectId && (
                <>
                  <Cap>Проект</Cap>
                  <NavLink href={p("")} label="Обзор" active={pathname === p("")} icon={IconLayoutDashboard} />
                  <NavLink href={p("/subscribers")} label="Подписчики" active={pathname.endsWith("/subscribers")} icon={IconUsers} />
                  <NavLink href={p("/campaigns")} label="Кампании" active={pathname.includes("/campaigns")} icon={IconSend} />
                  <NavLink href={p("/analytics")} label="Аналитика" active={pathname.endsWith("/analytics")} icon={IconChartBar} />
                  <NavLink href={p("/automations")} label="Автоматизации" active={pathname.endsWith("/automations")} icon={IconBolt} />
                  <NavLink href={p("/log")} label="Журнал" active={pathname.endsWith("/log")} icon={IconHistory} />
                  <NavLink href={p("/billing")} label="Биллинг" active={pathname.endsWith("/billing")} icon={IconCreditCard} />
                  <NavLink href={p("/api")} label="API" active={pathname.endsWith("/api")} icon={IconCode} />
                  <NavLink href={p("/auth")} label="Вход по телефону" active={pathname.endsWith("/auth")} icon={IconPhone} />
                  <NavLink href={p("/widget")} label="Кнопка и виджет" active={pathname.endsWith("/widget")} icon={IconBellRinging} />
                </>
              )}
              {isAdmin && (
                <>
                  <Cap>Платформа</Cap>
                  <NavLink href="/superadmin/clients" label="Клиенты" active={pathname.startsWith("/superadmin/clients")} icon={IconBuildingStore} />
                  <NavLink href="/superadmin/tariffs" label="Тарифы" active={pathname.startsWith("/superadmin/tariffs")} icon={IconTags} />
                </>
              )}
            </nav>

            <div className="flex md:flex-col gap-1 items-center md:items-stretch md:mt-6">
              <NavLink href="/admin/profile" label="Профиль" active={pathname === "/admin/profile"} icon={IconUser} />
              <button
                onClick={logout}
                className="flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm text-ink-muted hover:bg-surface-2 hover:text-ink cursor-pointer whitespace-nowrap"
              >
                <IconLogout size={18} stroke={1.8} className="shrink-0" />
                <span>Выход</span>
              </button>
            </div>
          </aside>

          {/* main column — footer lives here, inside the scrollable content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 px-5 py-6">{children}</div>
            <footer className="border-t border-border px-5 py-4 text-xs text-ink-faint text-center">
              © {new Date().getFullYear()} PushSaaS. Все права защищены.
            </footer>
          </div>
        </div>
      </div>
    </DialogProvider>
  );
}
