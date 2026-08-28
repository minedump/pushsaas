"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IconPlus,
  IconTrash,
  IconEye,
  IconCopy,
  IconFolderPlus,
  IconPencil,
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconSend,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { BulkActionsMenu, Button, ButtonLink, Checkbox, CustomSelect, Input, Label, Modal, SortableTh, useDialogs, type SortDir } from "@/app/ui";
import { friendlyError } from "@/lib/errors";
import { MessagePreviewModal } from "../MessagePreviewModal";
import { IdCopy } from "../IdCopy";

const PAGE_SIZE = 25;

type Channel = "push" | "sms" | "email";
type Folder = { id: string; name: string };
type Template = {
  id: string;
  name: string;
  channel: Channel;
  folder_id: string | null;
  subject: string | null;
  html: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  icon_url: string | null;
  image_url: string | null;
  badge_url: string | null;
  actions: { title: string; url: string }[] | null;
  context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  created_by_email: string | null;
  created_by_name: string | null;
};

const CHANNEL_LABEL: Record<Channel, string> = { push: "Push", sms: "SMS", email: "Email" };
type SortKey = "name" | "channel" | "folder" | "id" | "created_at" | "created_by";
const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "push", label: "Push" },
  { value: "sms", label: "SMS" },
];

export default function TemplatesManager({
  projectId,
  initialTemplates,
  initialFolders,
}: {
  projectId: string;
  initialTemplates: Template[];
  initialFolders: Folder[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, prompt, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [folderFilter, setFolderFilter] = useState<string>("all"); // "all" | "none" | folder id
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewTemplate = initialTemplates.find((t) => t.id === previewId) || null;
  const [editFolder, setEditFolder] = useState<Folder | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const folderName = (id: string | null) => (id ? (initialFolders.find((f) => f.id === id)?.name ?? "—") : null);

  function onSortClick(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
    }
  }

  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of initialTemplates) {
      const key = t.folder_id || "__none__";
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [initialTemplates]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = initialTemplates.filter((t) => {
      if (channelFilter !== "all" && t.channel !== channelFilter) return false;
      if (folderFilter === "none" && t.folder_id) return false;
      if (folderFilter !== "all" && folderFilter !== "none" && t.folder_id !== folderFilter) return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (sortKey === "created_at") return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        const av = sortKey === "folder" ? folderName(a.folder_id) || "" : sortKey === "created_by" ? a.created_by_email || "" : a[sortKey];
        const bv = sortKey === "folder" ? folderName(b.folder_id) || "" : sortKey === "created_by" ? b.created_by_email || "" : b[sortKey];
        return av.toString().localeCompare(bv.toString(), "ru") * dir;
      });
    }
    return list;
  }, [initialTemplates, channelFilter, folderFilter, search, sortKey, sortDir, initialFolders]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const paged = visible.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  function selectFolder(id: string) {
    setFolderFilter(id);
    setPage(1);
  }
  function selectChannel(v: string) {
    setChannelFilter(v as Channel | "all");
    setPage(1);
  }
  function updateSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectPage() {
    const pageIds = paged.map((t) => t.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    setSelected((s) => {
      const next = new Set(s);
      pageIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  // campaigns.template_id и automations.template_id (обычные welcome/
  // событийные) — настоящие FK с ON DELETE SET NULL, удаление шаблона им
  // ничем не грозит. А вот channel_templates каскадных автоматизаций —
  // просто jsonb {channel: templateId}, без FK и БЕЗ проверки при удалении:
  // потерять шаблон, на который ссылается канал каскада, значит молча
  // сломать этот канал (шлёт "пусто"/пропускает, без ошибки в интерфейсе).
  // Поэтому перед удалением явно проверяем это и блокируем с указанием, в
  // какой автоматизации шаблон используется — чинить порядок обратный:
  // сначала поменять шаблон в автоматизации, потом удалять сам шаблон.
  async function blockingCascadeAutomations(ids: string[]): Promise<{ automationName: string; templateName: string }[]> {
    const { data } = await supabase.from("automations").select("name, channel_templates").eq("project_id", projectId).eq("cascade", true);
    const idSet = new Set(ids);
    const nameById = new Map(initialTemplates.map((t) => [t.id, t.name]));
    const hits: { automationName: string; templateName: string }[] = [];
    for (const a of data ?? []) {
      const map = (a.channel_templates || {}) as Record<string, string>;
      for (const templateId of Object.values(map)) {
        if (idSet.has(templateId)) hits.push({ automationName: a.name || "Без названия", templateName: nameById.get(templateId) || templateId });
      }
    }
    return hits;
  }

  async function remove(id: string) {
    const blocking = await blockingCascadeAutomations([id]);
    if (blocking.length) {
      return toast(`Шаблон используется в каскадной автоматизации «${blocking[0].automationName}» — сначала замените его там`, "bad");
    }
    const ok = await confirm({
      title: "Удалить шаблон?",
      message: "Уже отправленные с ним рассылки не изменятся.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    await supabase.from("templates").delete().eq("id", id);
    setBusy(false);
    router.refresh();
  }

  // Копия шаблона(ов) — то же содержимое, имя с суффиксом «(копия)», в той
  // же папке. Используется и как быстрое действие в строке, и в массовых
  // действиях над выбранными шаблонами.
  async function duplicateTemplates(ids: string[]) {
    const items = initialTemplates.filter((t) => ids.includes(t.id));
    if (!items.length) return;
    const rows = items.map((t) => ({
      project_id: projectId,
      channel: t.channel,
      name: `${t.name} (копия)`,
      folder_id: t.folder_id,
      subject: t.subject,
      html: t.html,
      title: t.title,
      body: t.body,
      url: t.url,
      icon_url: t.icon_url,
      image_url: t.image_url,
      badge_url: t.badge_url,
      actions: t.actions,
    }));
    setBusy(true);
    const { error } = await supabase.from("templates").insert(rows);
    setBusy(false);
    if (error) return toast(friendlyError(error), "bad");
    toast(rows.length > 1 ? `Скопировано шаблонов: ${rows.length}` : "Шаблон скопирован", "good");
    setSelected(new Set());
    router.refresh();
  }

  async function bulkDelete() {
    const blocking = await blockingCascadeAutomations([...selected]);
    if (blocking.length) {
      const names = [...new Set(blocking.map((b) => b.automationName))].join(", ");
      return toast(`Часть шаблонов используется в каскадных автоматизациях (${names}) — сначала замените их там`, "bad");
    }
    const ok = await confirm({
      title: `Удалить ${selected.size} шаблон${selected.size === 1 ? "" : "ов"}?`,
      message: "Уже отправленные с ними рассылки не изменятся.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    await supabase.from("templates").delete().in("id", [...selected]);
    setBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  async function bulkMove(folderId: string) {
    setBusy(true);
    const { error } = await supabase
      .from("templates")
      .update({ folder_id: folderId || null })
      .in("id", [...selected]);
    setBusy(false);
    if (error) return toast(friendlyError(error), "bad");
    toast("Перемещено", "good");
    setSelected(new Set());
    setMoveOpen(false);
    router.refresh();
  }

  async function createFolder() {
    const name = await prompt({ title: "Новая папка", placeholder: "Например, «Транзакционные»", confirmText: "Создать" });
    if (!name?.trim()) return;
    const { error } = await supabase.from("template_folders").insert({ project_id: projectId, name: name.trim() });
    if (error) return toast(friendlyError(error), "bad");
    router.refresh();
  }

  async function saveFolder(f: Folder, name: string) {
    if (name === f.name) return setEditFolder(null);
    const { error } = await supabase.from("template_folders").update({ name }).eq("id", f.id);
    if (error) return toast(friendlyError(error), "bad");
    setEditFolder(null);
    router.refresh();
  }

  async function deleteFolder(f: Folder) {
    const ok = await confirm({
      title: `Удалить папку «${f.name}»?`,
      message: "Шаблоны внутри не удаляются — просто останутся без папки.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    if (folderFilter === f.id) setFolderFilter("all");
    setEditFolder(null);
    await supabase.from("template_folders").delete().eq("id", f.id);
    router.refresh();
  }

  return (
    <div className={busy ? "opacity-60" : ""}>
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Шаблоны</h1>
        <ButtonLink href={`/admin/projects/${projectId}/templates/new`}>
          <IconPlus size={16} stroke={2} />
          Новый шаблон
        </ButtonLink>
      </div>

      {/* Папки */}
      <div className="flex items-center gap-1.5 flex-wrap mt-7 mb-3">
        <FilterChip active={folderFilter === "all"} onClick={() => selectFolder("all")}>
          Все папки ({initialTemplates.length})
        </FilterChip>
        <FilterChip active={folderFilter === "none"} onClick={() => selectFolder("none")}>
          Без папки ({folderCounts.get("__none__") || 0})
        </FilterChip>
        {initialFolders.map((f) => (
          <div
            key={f.id}
            role="button"
            tabIndex={0}
            onClick={() => selectFolder(f.id)}
            onKeyDown={(e) => e.key === "Enter" && selectFolder(f.id)}
            className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-[12.5px] cursor-pointer transition-colors ${
              folderFilter === f.id ? "bg-accent-tint text-accent font-medium" : "text-ink-muted border border-border hover:border-accent-line"
            }`}
          >
            <span>
              {f.name} ({folderCounts.get(f.id) || 0})
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditFolder(f);
              }}
              className="p-0.5 rounded opacity-70 hover:opacity-100 cursor-pointer"
              title="Редактировать папку"
            >
              <IconPencil size={12} stroke={1.8} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={createFolder}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12.5px] text-ink-muted border border-dashed border-border hover:border-accent-line hover:text-accent cursor-pointer"
        >
          <IconFolderPlus size={13} stroke={1.8} />
          Папка
        </button>
      </div>

      {/* Канал + поиск */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <CustomSelect value={channelFilter} onChange={selectChannel} options={[{ value: "all", label: "Все каналы" }, ...CHANNEL_OPTIONS]} className="w-40" />
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <Input value={search} onChange={(e) => updateSearch(e.target.value)} placeholder="Поиск: название, ID" className="pl-9 pr-9" />
          {search && (
            <button
              type="button"
              onClick={() => updateSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-ink cursor-pointer"
              aria-label="Очистить поиск"
            >
              <IconX size={15} stroke={2} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
          {selected.size > 0 && (
            <div className="flex items-center gap-3 flex-wrap mb-3 px-3.5 py-2 rounded-lg bg-accent-tint">
              <span className="text-[13px] text-accent font-medium">Выбрано: {selected.size}</span>
              <div className="flex items-center gap-2 ml-auto">
                <BulkActionsMenu
                  items={[
                    { label: "Копировать", icon: <IconCopy size={15} stroke={1.8} />, onClick: () => duplicateTemplates([...selected]) },
                    { label: "Переместить", icon: <IconFolderPlus size={15} stroke={1.8} />, onClick: () => setMoveOpen(true) },
                  ]}
                />
                <Button variant="danger" size="sm" onClick={bulkDelete}>
                  Удалить
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
                  Отменить
                </Button>
              </div>
            </div>
          )}

          <div className="border border-border rounded-xl overflow-x-auto pretty-scroll">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-surface-2 text-left">
                  <Th>
                    <Checkbox checked={paged.length > 0 && paged.every((t) => selected.has(t.id))} onChange={toggleSelectPage} />
                  </Th>
                  <SortableTh label="Название" sortKey="name" active={sortKey === "name"} dir={sortDir} onClick={onSortClick} />
                  <SortableTh label="Канал" sortKey="channel" active={sortKey === "channel"} dir={sortDir} onClick={onSortClick} />
                  <SortableTh label="Папка" sortKey="folder" active={sortKey === "folder"} dir={sortDir} onClick={onSortClick} />
                  <SortableTh label="ID" sortKey="id" active={sortKey === "id"} dir={sortDir} onClick={onSortClick} />
                  <SortableTh label="Создан" sortKey="created_at" active={sortKey === "created_at"} dir={sortDir} onClick={onSortClick} />
                  <SortableTh label="Автор" sortKey="created_by" active={sortKey === "created_by"} dir={sortDir} onClick={onSortClick} />
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {paged.map((t) => (
                  <tr key={t.id} className={`border-t border-border ${selected.has(t.id) ? "bg-accent-tint/40" : ""}`}>
                    <Td>
                      <Checkbox checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} />
                    </Td>
                    <Td className="max-w-[220px]">
                      <Link
                        href={`/admin/projects/${projectId}/templates/${t.id}/edit`}
                        className="inline-flex items-center gap-1 max-w-full text-ink hover:text-accent hover:underline"
                      >
                        <span className="min-w-0 truncate">{t.name}</span>
                        <IconChevronRight size={13} stroke={2} className="text-ink-faint shrink-0" />
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">
                      <button
                        type="button"
                        onClick={() => selectChannel(t.channel)}
                        className="cursor-pointer hover:text-accent hover:underline"
                      >
                        {CHANNEL_LABEL[t.channel]}
                      </button>
                    </Td>
                    <Td className="text-ink-muted">
                      <button
                        type="button"
                        onClick={() => selectFolder(t.folder_id || "none")}
                        className="cursor-pointer hover:text-accent hover:underline"
                      >
                        {folderName(t.folder_id) || "—"}
                      </button>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <IdCopy id={t.id} />
                    </Td>
                    <Td className="text-ink-faint whitespace-nowrap">
                      {new Date(t.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                    </Td>
                    <Td className="max-w-[160px]" title={t.created_by_email || undefined}>
                      {t.created_by_name ? (
                        <div className="min-w-0">
                          <div className="text-ink-muted truncate">{t.created_by_name}</div>
                          <div className="text-[11px] text-ink-faint truncate">{t.created_by_email}</div>
                        </div>
                      ) : (
                        <div className="text-ink-muted truncate">{t.created_by_email || "—"}</div>
                      )}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/admin/projects/${projectId}/templates/${t.id}/edit`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
                          title="Изменить"
                        >
                          <IconPencil size={15} stroke={1.8} />
                        </Link>
                        <Link
                          href={`/admin/projects/${projectId}/campaigns/new?channel=${t.channel}&templateId=${t.id}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
                          title="Отправить рассылку"
                        >
                          <IconSend size={15} stroke={1.8} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setPreviewId(t.id)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer"
                          title="Превью"
                        >
                          <IconEye size={15} stroke={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateTemplates([t.id])}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2 cursor-pointer"
                          title="Копировать"
                        >
                          <IconCopy size={15} stroke={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(t.id)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-ink-muted hover:text-bad hover:bg-surface-2 cursor-pointer"
                          title="Удалить"
                        >
                          <IconTrash size={15} stroke={1.8} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3.5 py-6 text-center text-ink-muted">
                      Шаблонов пока нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {visible.length > 0 && (
            <div className="flex items-center justify-between mt-3 text-[13px] text-ink-muted">
              <span>
                {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, visible.length)} из {visible.length}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={pageSafe <= 1} onClick={() => setPage((p) => p - 1)}>
                  <IconChevronLeft size={15} stroke={2} />
                </Button>
                <span className="tabular-nums">
                  {pageSafe} / {pageCount}
                </span>
                <Button variant="secondary" size="sm" disabled={pageSafe >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  <IconChevronRight size={15} stroke={2} />
                </Button>
              </div>
            </div>
          )}
        </div>

      {previewTemplate && (
        <MessagePreviewModal
          label={previewTemplate.name}
          content={{
            channel: previewTemplate.channel,
            title: previewTemplate.title,
            body: previewTemplate.body,
            url: previewTemplate.url,
            icon_url: previewTemplate.icon_url,
            image_url: previewTemplate.image_url,
            badge_url: previewTemplate.badge_url,
            actions: previewTemplate.actions,
            subject: previewTemplate.subject,
            html: previewTemplate.html,
          }}
          sampleData={{ template: previewTemplate.context || {} }}
          projectId={projectId}
          onClose={() => setPreviewId(null)}
        />
      )}
      {editFolder && (
        <FolderEditModal
          folder={editFolder}
          onSave={(name) => saveFolder(editFolder, name)}
          onDelete={() => deleteFolder(editFolder)}
          onClose={() => setEditFolder(null)}
        />
      )}
      {moveOpen && <MoveModal count={selected.size} folders={initialFolders} onMove={bulkMove} onClose={() => setMoveOpen(false)} />}
    </div>
  );
}

// Попап массового перемещения выбранных шаблонов в папку (или «Без папки»).
function MoveModal({
  count,
  folders,
  onMove,
  onClose,
}: {
  count: number;
  folders: Folder[];
  onMove: (folderId: string) => void;
  onClose: () => void;
}) {
  const [folderId, setFolderId] = useState("");
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold m-0">
          Переместить {count} шаблон{count === 1 ? "" : "ов"}
        </h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <Label>Папка</Label>
      <CustomSelect
        value={folderId}
        onChange={setFolderId}
        options={[{ value: "", label: "Без папки" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
        className="w-full"
        ariaLabel="Папка"
      />

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Отмена
        </Button>
        <Button size="sm" onClick={() => onMove(folderId)}>
          Переместить
        </Button>
      </div>
    </Modal>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3.5 py-2.5 text-[11px] text-ink-faint font-normal whitespace-nowrap text-left">{children}</th>
);
const Td = ({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) => (
  <td className={`px-3.5 py-3 align-middle ${className}`} title={title}>
    {children}
  </td>
);

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[12.5px] cursor-pointer transition-colors ${
        active ? "bg-accent-tint text-accent font-medium" : "text-ink-muted border border-border hover:border-accent-line"
      }`}
    >
      {children}
    </button>
  );
}

// Попап редактирования папки, открывается по карандашику на чипе —
// переименование и удаление в одном месте, вместо отдельных иконок на чипе.
function FolderEditModal({
  folder,
  onSave,
  onDelete,
  onClose,
}: {
  folder: Folder;
  onSave: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder.name);
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold m-0">Папка</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <Label>Название</Label>
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
      />

      <div className="flex items-center justify-between gap-2 mt-5">
        <Button variant="danger" size="sm" onClick={onDelete}>
          Удалить
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

