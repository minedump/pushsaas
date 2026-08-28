"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconCloudUpload,
  IconCopy,
  IconCheck,
  IconTrash,
  IconX,
  IconPhoto,
  IconFolderPlus,
  IconPencil,
  IconSearch,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Checkbox, CustomSelect, Input, Label, Modal, useDialogs } from "@/app/ui";
import { friendlyError } from "@/lib/errors";
import { formatAuthor, formatShortDate } from "../formatAuthor";

type Folder = { id: string; name: string };
type Asset = {
  id: string;
  name: string;
  url: string;
  size: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  folder_id: string | null;
  created_at: string;
  created_by_email: string | null;
  created_by_name: string | null;
};

const MAX_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 24;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

// Галерея изображений проекта (миграция 0081/0082) — свободная загрузка
// картинок для использования в HTML писем/шаблонов вручную (просто
// копируешь публичную ссылку), без привязки к конкретной рассылке. Папки и
// массовые действия — та же модель, что у Шаблонов (TemplatesManager.tsx),
// только вид не таблица, а плитка миниатюр.
export default function MediaLibrary({
  projectId,
  initialAssets,
  initialFolders,
}: {
  projectId: string;
  initialAssets: Asset[];
  initialFolders: Folder[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const { confirm, prompt, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [folderFilter, setFolderFilter] = useState<string>("all"); // "all" | "none" | folder id
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [editFolder, setEditFolder] = useState<Folder | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const folderName = (id: string | null) => (id ? (initialFolders.find((f) => f.id === id)?.name ?? "—") : null);

  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of initialAssets) {
      const key = a.folder_id || "__none__";
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [initialAssets]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialAssets.filter((a) => {
      if (folderFilter === "none" && a.folder_id) return false;
      if (folderFilter !== "all" && folderFilter !== "none" && a.folder_id !== folderFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initialAssets, folderFilter, search]);

  const paged = useMemo(() => visible.slice(0, limit), [visible, limit]);

  function selectFolder(id: string) {
    setFolderFilter(id);
    setLimit(PAGE_SIZE);
  }

  function updateSearch(v: string) {
    setSearch(v);
    setLimit(PAGE_SIZE);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function upload(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return toast("Можно загружать только изображения", "bad");
    const tooBig = list.find((f) => f.size > MAX_BYTES);
    if (tooBig) return toast(`«${tooBig.name}» больше 20 МБ`, "bad");

    setUploading(true);
    for (const file of list) {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", file);
      const res = await fetch("/api/admin/media/upload", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error || `Не удалось загрузить «${file.name}»`, "bad");
        continue;
      }
    }
    setUploading(false);
    router.refresh();
  }

  async function copyUrl(asset: Asset) {
    await navigator.clipboard.writeText(asset.url);
    setCopiedId(asset.id);
    setTimeout(() => setCopiedId((v) => (v === asset.id ? null : v)), 1500);
  }

  async function removeMany(ids: string[]) {
    const ok = await confirm({
      title: `Удалить ${ids.length} изображени${ids.length === 1 ? "е" : "я"}?`,
      message: "Ссылки перестанут работать — если они уже используются в отправленных письмах, картинки там пропадут.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/admin/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ids }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast(j.error || "Ошибка удаления", "bad");
    }
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setPreviewAsset((prev) => (prev && ids.includes(prev.id) ? null : prev));
    toast("Удалено", "good");
    router.refresh();
  }

  async function bulkMove(folderId: string) {
    setBusy(true);
    const { error } = await supabase
      .from("media_assets")
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
    const name = await prompt({ title: "Новая папка", placeholder: "Например, «Баннеры»", confirmText: "Создать" });
    if (!name?.trim()) return;
    const { error } = await supabase.from("media_folders").insert({ project_id: projectId, name: name.trim() });
    if (error) return toast(friendlyError(error), "bad");
    router.refresh();
  }

  async function saveFolder(f: Folder, name: string) {
    if (name === f.name) return setEditFolder(null);
    const { error } = await supabase.from("media_folders").update({ name }).eq("id", f.id);
    if (error) return toast(friendlyError(error), "bad");
    setEditFolder(null);
    router.refresh();
  }

  async function deleteFolder(f: Folder) {
    const ok = await confirm({
      title: `Удалить папку «${f.name}»?`,
      message: "Изображения внутри не удаляются — просто останутся без папки.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    if (folderFilter === f.id) setFolderFilter("all");
    setEditFolder(null);
    await supabase.from("media_folders").delete().eq("id", f.id);
    router.refresh();
  }

  return (
    <div className={busy ? "opacity-60" : ""}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold m-0">Файлы</h1>
        <Button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <IconCloudUpload size={16} stroke={1.8} />
          {uploading ? "Загружаем…" : "Загрузить"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Папки */}
      <div className="flex items-center gap-1.5 flex-wrap mt-5 mb-4">
        <FilterChip active={folderFilter === "all"} onClick={() => selectFolder("all")}>
          Все папки ({initialAssets.length})
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

      <div className="relative mb-4">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        {/* Плейсхолдер называет только «название» — по id тоже ищет (см. фильтр
            в visible выше), просто не выносим это в подсказку, чтобы не
            перегружать её. */}
        <Input value={search} onChange={(e) => updateSearch(e.target.value)} placeholder="Поиск: название" className="pl-9 pr-9" />
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

      {selected.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-3 px-3.5 py-2 rounded-lg bg-accent-tint">
          <span className="text-[13px] text-accent font-medium">Выбрано: {selected.size}</span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={() => setMoveOpen(true)}>
              <IconFolderPlus size={14} stroke={1.8} />
              Переместить
            </Button>
            <Button variant="danger" size="sm" onClick={() => removeMany([...selected])}>
              Удалить
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
              Отменить
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center rounded-xl border border-border">
          <IconPhoto size={28} stroke={1.5} className="text-ink-faint" />
          <p className="text-[13.5px] text-ink-muted m-0">
            {initialAssets.length === 0
              ? "Пока ничего не загружено — нажмите «Загрузить»"
              : search.trim()
                ? "Ничего не найдено"
                : "В этой папке пусто"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {paged.map((a) => {
            const isSelected = selected.has(a.id);
            return (
              <div key={a.id} className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
                <div className="group relative w-full aspect-square overflow-hidden bg-surface-2">
                  <div
                    onClick={() => setPreviewAsset(a)}
                    className="flex items-center justify-center w-full h-full cursor-pointer overflow-hidden p-2"
                    title="Просмотр"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.name} className="max-w-full max-h-full object-contain" />
                  </div>

                  <div className={`absolute top-1.5 left-1.5 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    <Checkbox checked={isSelected} onChange={() => toggleSelect(a.id)} />
                  </div>

                  <div className="absolute top-1.5 right-1.5 flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => copyUrl(a)}
                      title="Скопировать ссылку"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-black/55 backdrop-blur-sm text-white hover:bg-black/70 cursor-pointer"
                    >
                      {copiedId === a.id ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMany([a.id])}
                      title="Удалить"
                      className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-black/55 backdrop-blur-sm text-white hover:bg-bad hover:text-white cursor-pointer"
                    >
                      <IconTrash size={14} stroke={1.8} />
                    </button>
                  </div>
                </div>
                <div className="p-2.5 flex flex-col gap-0.5">
                  <div className="text-[12.5px] font-medium truncate" title={a.name}>
                    {a.name}
                  </div>
                  <div className="text-[11px] text-ink-faint truncate">
                    {fmtDate(a.created_at)} · {fmtSize(a.size)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {visible.length > paged.length && (
        <div className="flex justify-center mt-4">
          <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Показать ещё ({visible.length - paged.length})
          </Button>
        </div>
      )}

      {previewAsset && (
        <Modal onClose={() => setPreviewAsset(null)} className="max-w-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
            <h3 className="text-base font-semibold m-0 truncate">{previewAsset.name}</h3>
            <button type="button" onClick={() => setPreviewAsset(null)} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
              <IconX size={18} stroke={1.8} />
            </button>
          </div>
          <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
            <div className="rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewAsset.url} alt={previewAsset.name} className="max-w-full max-h-[55vh] object-contain" />
            </div>
            <div className="text-[13px] text-ink-muted mt-3 flex flex-col gap-1">
              <div>
                {fmtSize(previewAsset.size)}
                {previewAsset.width && previewAsset.height && ` · ${previewAsset.width}×${previewAsset.height}`} · {previewAsset.mime_type}
                {folderName(previewAsset.folder_id) && ` · ${folderName(previewAsset.folder_id)}`}
              </div>
              <div>
                {formatAuthor(previewAsset.created_by_name, previewAsset.created_by_email)} · {formatShortDate(previewAsset.created_at)}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button variant="secondary" size="sm" onClick={() => copyUrl(previewAsset)}>
                {copiedId === previewAsset.id ? <IconCheck size={14} stroke={2} /> : <IconCopy size={14} stroke={1.8} />}
                {copiedId === previewAsset.id ? "Скопировано" : "Скопировать ссылку"}
              </Button>
              <Button variant="danger" size="sm" onClick={() => removeMany([previewAsset.id])}>
                Удалить
              </Button>
            </div>
          </div>
        </Modal>
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

// Попап массового перемещения выбранных изображений в папку (или «Без папки»).
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
          Переместить {count} изображени{count === 1 ? "е" : "я"}
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

// Попап редактирования папки, открывается по карандашику на чипе —
// переименование и удаление в одном месте.
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
