"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  IconBell,
  IconLayoutGrid,
  IconPlus,
  IconGauge,
  IconTemplate,
  IconPlugConnected,
  IconSettings,
  IconUsers,
  IconSend,
  IconChartBar,
  IconBolt,
  IconCreditCard,
  IconCode,
  IconLogin2,
  IconBuildingStore,
  IconTags,
  IconUser,
  IconLogout,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconHistory,
  type TablerIcon,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { CustomSelect } from "@/app/ui/CustomSelect";
import { DialogProvider } from "@/app/ui/Dialogs";
import { cn } from "@/app/ui/cn";

type Project = { id: string; name: string };

const ALL_PROJECTS = "__all__";

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
  const [collapsed, setCollapsed] = useState(false);

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
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm transition-colors whitespace-nowrap shrink-0",
        active ? "bg-accent-tint text-accent font-semibold" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      )}
    >
      <Ico size={18} stroke={1.8} className="shrink-0" />
      {!collapsed && <span>{label}</span>}
    </a>
  );

  const p = (s: string) => (currentProjectId ? `/admin/projects/${currentProjectId}${s}` : "#");

  return (
    <DialogProvider>
      <div className="min-h-screen flex flex-col">
        {/* header */}
        <header className="sticky top-0 z-20 h-14 flex items-center gap-4 px-5 border-b border-border bg-surface">
          <a href="/admin" className="flex items-center gap-2 font-bold text-base text-ink whitespace-nowrap no-underline">
            <IconBell size={20} stroke={1.8} className="text-accent" />
            SENDERA
          </a>
          <div className="ml-auto flex items-center gap-2">
            <CustomSelect
              value={currentProjectId || ALL_PROJECTS}
              onChange={(v) => router.push(v === ALL_PROJECTS ? "/admin" : `/admin/projects/${v}`)}
              options={[{ value: ALL_PROJECTS, label: "Все проекты" }, ...projects.map((pr) => ({ value: pr.id, label: pr.name }))]}
              placeholder={projects.length ? "Выберите проект" : "Нет проектов"}
              ariaLabel="Текущий проект"
              className="w-[220px]"
            />
            {!isAdmin && (
              <a
                href="/admin/projects/new"
                title="Создать проект"
                className="grid place-items-center w-[38px] h-[38px] rounded-lg border border-border text-ink-muted hover:border-accent hover:text-accent no-underline"
              >
                <IconPlus size={18} stroke={2} />
              </a>
            )}
            <button
              onClick={logout}
              title="Выход"
              className="grid place-items-center w-[38px] h-[38px] rounded-lg border border-border text-ink-muted hover:border-accent hover:text-accent cursor-pointer"
            >
              <IconLogout size={18} stroke={1.8} />
            </button>
          </div>
        </header>

        {/* body */}
        <div className="flex flex-1 flex-col md:flex-row">
          <aside
            className={cn(
              "w-full shrink-0 border-b md:border-b-0 md:border-r border-border bg-surface md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] flex md:flex-col md:justify-between gap-1 p-2 md:p-3 overflow-x-auto md:overflow-x-hidden transition-[width]",
              collapsed ? "md:w-16" : "md:w-56"
            )}
          >
            <nav className="flex md:flex-col gap-1 items-center md:items-stretch">
              {currentProjectId && (
                <>
                  <NavLink href={p("")} label="Дашборд" active={pathname === p("")} icon={IconGauge} />
                  <NavLink href={p("/campaigns")} label="Рассылки" active={pathname.includes("/campaigns")} icon={IconSend} />
                  <NavLink href={p("/templates")} label="Шаблоны" active={pathname.endsWith("/templates")} icon={IconTemplate} />
                  <NavLink href={p("/subscribers")} label="Подписчики" active={pathname.endsWith("/subscribers")} icon={IconUsers} />
                  <NavLink href={p("/analytics")} label="Аналитика" active={pathname.endsWith("/analytics")} icon={IconChartBar} />
                  <NavLink href={p("/automations")} label="Автоматизации" active={pathname.endsWith("/automations")} icon={IconBolt} />
                  <NavLink href={p("/log")} label="Журнал" active={pathname.endsWith("/log")} icon={IconHistory} />
                  <NavLink href={p("/auth")} label="Авторизация" active={pathname.endsWith("/auth")} icon={IconLogin2} />
                  <NavLink href={p("/widget")} label="Виджеты" active={pathname.endsWith("/widget")} icon={IconLayoutGrid} />
                  <NavLink href={p("/connections")} label="Подключения" active={pathname.endsWith("/connections")} icon={IconPlugConnected} />
                  <NavLink href={p("/settings")} label="Настройки" active={pathname.endsWith("/settings")} icon={IconSettings} />
                  <NavLink href={p("/api")} label="API" active={pathname.endsWith("/api")} icon={IconCode} />
                  <NavLink href={p("/billing")} label="Биллинг" active={pathname.endsWith("/billing")} icon={IconCreditCard} />
                </>
              )}
              {isAdmin && (
                <>
                  {currentProjectId && <div className="w-full h-px bg-border my-2" />}
                  <NavLink href="/superadmin/clients" label="Клиенты" active={pathname.startsWith("/superadmin/clients")} icon={IconBuildingStore} />
                  <NavLink href="/superadmin/tariffs" label="Тарифы" active={pathname.startsWith("/superadmin/tariffs")} icon={IconTags} />
                </>
              )}
            </nav>

            <div className="flex md:flex-col gap-1 items-center md:items-stretch md:mt-6">
              <button
                onClick={() => setCollapsed((v) => !v)}
                title={collapsed ? "Развернуть меню" : "Свернуть меню"}
                className="hidden md:flex items-center gap-2.5 h-9 text-left px-3 rounded-lg text-sm text-ink-muted hover:bg-surface-2 hover:text-ink cursor-pointer whitespace-nowrap shrink-0"
              >
                {collapsed ? (
                  <IconLayoutSidebarLeftExpand size={18} stroke={1.8} className="shrink-0" />
                ) : (
                  <IconLayoutSidebarLeftCollapse size={18} stroke={1.8} className="shrink-0" />
                )}
                {!collapsed && <span>Свернуть</span>}
              </button>
              <div className="hidden md:block w-full h-px bg-border my-1" />
              <NavLink href="/admin/profile" label="Профиль" active={pathname === "/admin/profile"} icon={IconUser} />
            </div>
          </aside>

          {/* main column — footer lives here, inside the scrollable content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 px-5 py-6">{children}</div>
            <footer className="border-t border-border px-5 py-4 text-xs text-ink-faint text-center">
              © {new Date().getFullYear()} SENDERA. Все права защищены.
            </footer>
          </div>
        </div>
      </div>
    </DialogProvider>
  );
}
