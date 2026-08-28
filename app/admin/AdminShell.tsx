"use client";

import { useEffect, useRef, useState } from "react";
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
  IconSun,
  IconMoon,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconHistory,
  IconCheck,
  IconPhoto,
  type TablerIcon,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { CustomSelect } from "@/app/ui/CustomSelect";
import { DialogProvider } from "@/app/ui/Dialogs";
import { cn } from "@/app/ui/cn";

type Project = { id: string; name: string; is_active: boolean };

const ALL_PROJECTS = "__all__";
const SIDEBAR_COLLAPSED_KEY = "sendera-sidebar-collapsed";

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

  // Ссылки меню — обычные <a>, не next/link (полная перезагрузка страницы
  // при переходе), поэтому состояние сворачивания сайдбара живёт не в React
  // state, а в localStorage. Класс "sb-collapsed" на <html> инлайн-скрипт
  // ниже (см. JSX) выставляет синхронно ДО гидратации через чистый CSS
  // (globals.css) — тот же приём, что и с темой в layout.tsx. Здесь только
  // подтягиваем React-стейт под уже верно выставленный класс, саму
  // DOM-разметку не трогаем: если снять и тут же вернуть класс, получится
  // мелькание, усиленное transition-[width] на aside.
  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      document.documentElement.classList.toggle("sb-collapsed", next);
      return next;
    });
  }

  const isAdmin = role === "admin";
  const currentProjectId = pathname.match(/\/admin\/projects\/([0-9a-f-]{36})/i)?.[1];
  const currentProject = projects.find((pr) => pr.id === currentProjectId);
  // Заблокированному (is_active=false) владельцу — как ensureProjectAccessible
  // на сервере (lib/guards.ts) — доступны только «Биллинг» и «Профиль».
  // Суперадмина ограничение не касается (та же логика, что и на сервере).
  const projectBlocked = !!currentProject && !currentProject.is_active && !isAdmin;

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Общий вид строки меню сайдбара — и обычные пункты (ссылки), и переключатель
  // Свернуть/Развернуть (кнопка, не ссылка) — одна и та же геометрия/паддинги/
  // квадрат в свёрнутом состоянии, чтобы не держать классы синхронными вручную
  // в двух местах (см. историю правок отступов выше). href → рендерит <a>,
  // onClick без href → <button>.
  const SidebarButton = ({
    href,
    onClick,
    label,
    active = false,
    title: titleProp,
    hideOnMobile = false,
    icon: Ico,
  }: {
    href?: string;
    onClick?: () => void;
    label: string;
    active?: boolean;
    title?: string;
    hideOnMobile?: boolean;
    icon: TablerIcon;
  }) => {
    const className = cn(
      hideOnMobile ? "hidden md:flex" : "flex",
      "items-center gap-2 h-8 rounded-lg text-[13px] transition-[width,padding,margin,background-color,color] whitespace-nowrap shrink-0 px-2 cursor-pointer text-left",
      collapsed && "md:w-8",
      active ? "bg-accent-tint text-accent font-semibold" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
    );
    const title = titleProp ?? (collapsed ? label : undefined);
    const content = (
      <>
        <Ico size={16} stroke={1.8} className="shrink-0" />
        {!collapsed && <span data-sidebar-label>{label}</span>}
      </>
    );
    if (href) {
      return (
        <a href={href} title={title} className={className} data-sidebar-btn>
          {content}
        </a>
      );
    }
    return (
      <button type="button" onClick={onClick} title={title} className={className} data-sidebar-btn>
        {content}
      </button>
    );
  };

  const p = (s: string) => (currentProjectId ? `/admin/projects/${currentProjectId}${s}` : "#");

  return (
    <DialogProvider>
      <script
        // Синхронно, до гидратации — иначе виден мелькающий пересвет
        // развёрнутого меню при каждом переходе (полная перезагрузка, см.
        // комментарий у useEffect выше). Правила для класса — в globals.css.
        dangerouslySetInnerHTML={{
          __html: `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_COLLAPSED_KEY)})==='1')document.documentElement.classList.add('sb-collapsed')}catch(e){}`,
        }}
      />
      <div className="min-h-screen flex flex-col">
        {/* header */}
        <header className="sticky top-0 z-20 h-14 flex items-center gap-4 px-4 border-b border-border bg-surface">
          <a href="/admin" className="flex items-center gap-2 font-bold text-base text-ink whitespace-nowrap no-underline">
            <IconBell size={20} stroke={1.8} className="text-accent" />
            SENDERA
          </a>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden md:block">
              <CustomSelect
                value={currentProjectId || ALL_PROJECTS}
                onChange={(v) => router.push(v === ALL_PROJECTS ? "/admin" : `/admin/projects/${v}`)}
                options={[{ value: ALL_PROJECTS, label: "Все проекты" }, ...projects.map((pr) => ({ value: pr.id, label: pr.name }))]}
                placeholder={projects.length ? "Выберите проект" : "Нет проектов"}
                ariaLabel="Текущий проект"
                className="w-[220px]"
                footer={
                  <a href="/admin/projects/new" className="flex items-center gap-2 w-full text-left text-sm px-3 py-2 text-ink hover:bg-surface-2 cursor-pointer no-underline">
                    <IconPlus size={15} stroke={2} />
                    Создать проект
                  </a>
                }
              />
            </div>
            <ProjectSwitcherIcon
              projects={projects}
              currentProjectId={currentProjectId}
              onSelect={(v) => router.push(v === ALL_PROJECTS ? "/admin" : `/admin/projects/${v}`)}
            />
            <ThemeToggle />
            <button
              onClick={logout}
              title="Выход"
              className="grid place-items-center w-[38px] h-[38px] rounded-lg border border-border text-ink bg-surface hover:bg-surface-2 cursor-pointer"
            >
              <IconLogout size={18} stroke={1.8} />
            </button>
          </div>
        </header>

        {/* body */}
        <div className="flex flex-1 flex-col md:flex-row">
          <aside
            data-sidebar
            className={cn(
              "w-full shrink-0 border-b md:border-b-0 md:border-r border-border bg-surface md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] flex md:flex-col md:justify-between gap-1 p-2 md:p-2.5 overflow-x-auto md:overflow-x-hidden pretty-scroll transition-[width]",
              // 52px = 10px (p-2.5) + 32px (кнопка h-8/w-8) + 10px — тот же
              // отступ от края, что и в развёрнутом состоянии, с двух сторон,
              // без лишнего места, которое пришлось бы центрировать (md:mx-auto
              // на самих кнопках больше не нужен).
              collapsed ? "md:w-[52px]" : "md:w-56"
            )}
          >
            <nav className="flex md:flex-col gap-1 items-center md:items-stretch">
              {currentProjectId && (
                <>
                  {!projectBlocked && (
                    <>
                      <SidebarButton href={p("")} label="Дашборд" active={pathname === p("")} icon={IconGauge} />
                      <SidebarButton href={p("/analytics")} label="Аналитика" active={pathname.endsWith("/analytics")} icon={IconChartBar} />
                      <SidebarButton href={p("/campaigns")} label="Рассылки" active={pathname.includes("/campaigns")} icon={IconSend} />
                      <SidebarButton href={p("/subscribers")} label="Подписчики" active={pathname.endsWith("/subscribers")} icon={IconUsers} />
                      <SidebarButton href={p("/templates")} label="Шаблоны" active={pathname.endsWith("/templates")} icon={IconTemplate} />
                      <SidebarButton href={p("/media")} label="Файлы" active={pathname.endsWith("/media")} icon={IconPhoto} />
                      <SidebarButton href={p("/automations")} label="Автоматизации" active={pathname.endsWith("/automations")} icon={IconBolt} />
                      <SidebarButton href={p("/widget")} label="Виджеты" active={pathname.endsWith("/widget")} icon={IconLayoutGrid} />
                      <SidebarButton href={p("/auth")} label="Авторизация" active={pathname.endsWith("/auth")} icon={IconLogin2} />
                      <SidebarButton href={p("/connections")} label="Подключения" active={pathname.endsWith("/connections")} icon={IconPlugConnected} />
                      <SidebarButton href={p("/settings")} label="Настройки" active={pathname.endsWith("/settings")} icon={IconSettings} />
                      <SidebarButton href={p("/api")} label="API" active={pathname.endsWith("/api")} icon={IconCode} />
                      <SidebarButton href={p("/log")} label="Журнал" active={pathname.endsWith("/log")} icon={IconHistory} />
                    </>
                  )}
                  <SidebarButton href={p("/billing")} label="Биллинг" active={pathname.endsWith("/billing")} icon={IconCreditCard} />
                </>
              )}
              {isAdmin && (
                <>
                  {currentProjectId && <div className="w-px h-8 mx-1 bg-border md:w-full md:h-px md:mx-0 md:my-1.5" />}
                  <SidebarButton href="/superadmin/clients" label="Клиенты" active={pathname.startsWith("/superadmin/clients")} icon={IconBuildingStore} />
                  <SidebarButton href="/superadmin/tariffs" label="Тарифы" active={pathname.startsWith("/superadmin/tariffs")} icon={IconTags} />
                </>
              )}
            </nav>

            {(currentProjectId || isAdmin) && <div className="w-px h-8 mx-1 bg-border shrink-0 md:hidden" />}

            <div className="flex md:flex-col gap-1 items-center md:items-stretch md:mt-3">
              <SidebarButton
                onClick={toggleCollapsed}
                label="Свернуть"
                title={collapsed ? "Развернуть меню" : "Свернуть меню"}
                hideOnMobile
                icon={collapsed ? IconLayoutSidebarLeftExpand : IconLayoutSidebarLeftCollapse}
              />
              <div className="hidden md:block w-full h-px bg-border my-1.5" />
              <SidebarButton href="/admin/profile" label="Профиль" active={pathname === "/admin/profile"} icon={IconUser} />
            </div>
          </aside>

          {/* main column — footer lives here, inside the scrollable content */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 px-5 py-6">{children}</div>
            <footer className="border-t border-border px-5 py-[18px] text-xs text-ink-faint text-center bg-surface">
              © {new Date().getFullYear()} SENDERA. Все права защищены.
            </footer>
          </div>
        </div>
      </div>
    </DialogProvider>
  );
}

// Компактная версия переключателя проектов для телефона — та же логика
// (открыть/закрыть по клику вне и Escape), что у CustomSelect, но триггер —
// просто иконка (как соседние кнопки "+"/выход в хедере), а не поле с
// текстом: полю с названием проекта на узком экране банально не хватает
// места рядом с логотипом и остальными иконками.
function ProjectSwitcherIcon({
  projects,
  currentProjectId,
  onSelect,
}: {
  projects: Project[];
  currentProjectId: string | undefined;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = projects.find((p) => p.id === currentProjectId);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative md:hidden">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Текущий проект"
        title={current?.name || "Все проекты"}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "grid place-items-center w-[38px] h-[38px] rounded-lg border border-border text-ink bg-surface hover:bg-surface-2 cursor-pointer transition-colors",
          open && "border-accent-line ring-2 ring-accent-line"
        )}
      >
        <IconBuildingStore size={18} stroke={1.8} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-30 mt-1.5 w-56 max-h-72 overflow-auto pretty-scroll rounded-lg border border-border bg-surface shadow-lg py-1"
          style={{ animation: "ui-pop .12s ease-out" }}
        >
          {[{ id: ALL_PROJECTS, name: "Все проекты" }, ...projects].map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === (currentProjectId || ALL_PROJECTS)}>
              <button
                type="button"
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center justify-between gap-2 w-full text-left text-sm px-3 py-2 transition-colors cursor-pointer",
                  p.id === (currentProjectId || ALL_PROJECTS) ? "bg-accent-tint text-accent font-semibold" : "text-ink hover:bg-surface-2"
                )}
              >
                <span className="truncate">{p.name}</span>
                {p.id === (currentProjectId || ALL_PROJECTS) && <IconCheck size={15} stroke={2.2} className="shrink-0" />}
              </button>
            </li>
          ))}
          <li role="presentation" className="my-1 h-px bg-border" />
          <li>
            <a
              href="/admin/projects/new"
              className="flex items-center gap-2 w-full text-left text-sm px-3 py-2 text-ink hover:bg-surface-2 cursor-pointer no-underline"
            >
              <IconPlus size={15} stroke={2} />
              Создать проект
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}

const THEME_KEY = "sendera-theme";

// Явный выбор темы поверх системной — читаем сохранённый выбор (тот же
// ключ, что инлайн-скрипт в layout.tsx уже применил ДО гидратации, чтобы
// избежать мигания), при отсутствии выбора ориентируемся на текущую
// системную тему только для того, какую иконку показать (сама тема уже
// корректно взята из CSS media-query, эта кнопка лишь позволяет её перебить).
function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  const systemDark = mounted && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme ? theme === "dark" : systemDark;

  function toggle() {
    const next: "light" | "dark" = isDark ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  }

  return (
    <button
      onClick={toggle}
      title={mounted ? (isDark ? "Светлая тема" : "Тёмная тема") : undefined}
      className="grid place-items-center w-[38px] h-[38px] rounded-lg border border-border text-ink bg-surface hover:bg-surface-2 cursor-pointer"
    >
      {isDark ? <IconSun size={18} stroke={1.8} /> : <IconMoon size={18} stroke={1.8} />}
    </button>
  );
}
