"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconEye, IconX, IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, CustomSelect, Input, Label, Textarea, useDialogs } from "@/app/ui";
import { MessagePreviewModal, type PreviewContent } from "../../../MessagePreviewModal";
import { ContextField } from "../../../ContextField";
import { smsSegments } from "@/lib/smsSegments";
import { hasUnsubscribeTag } from "@/lib/unsubscribeTag";

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
};

const CHANNEL_LABEL: Record<Channel, string> = { push: "Push", sms: "SMS", email: "Email" };

export default function EditTemplateForm({ projectId, template, folders }: { projectId: string; template: Template; folders: Folder[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { toast, confirm } = useDialogs();
  const channel = template.channel;

  const [name, setName] = useState(template.name);
  const [folderId, setFolderId] = useState(template.folder_id || "");
  const [subject, setSubject] = useState(template.subject || "");
  const [html, setHtml] = useState(template.html || "");
  const [title, setTitle] = useState(template.title || "");
  const [body, setBody] = useState(template.body || "");
  const [url, setUrl] = useState(template.url || "");
  const [iconUrl, setIconUrl] = useState(template.icon_url || "");
  const [imageUrl, setImageUrl] = useState(template.image_url || "");
  const [badgeUrl, setBadgeUrl] = useState(template.badge_url || "");
  const [actions, setActions] = useState<{ title: string; url: string }[]>(template.actions || []);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [contextEnabled, setContextEnabled] = useState(false);
  const [contextJson, setContextJson] = useState("");

  // Тестовый контекст только для превью — та же логика, что и в форме создания.
  let contextData: Record<string, unknown> | undefined;
  let contextError: string | null = null;
  if (contextEnabled && contextJson.trim()) {
    try {
      const parsed = JSON.parse(contextJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) contextData = parsed;
      else contextError = "Контекст должен быть JSON-объектом";
    } catch {
      contextError = "Невалидный JSON";
    }
  }

  const previewContent: PreviewContent =
    channel === "push"
      ? { channel, title, body, url, icon_url: iconUrl, image_url: imageUrl, actions }
      : channel === "sms"
      ? { channel, body }
      : { channel, subject, html };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast("Название обязательно", "bad");
    if (channel === "email" && !html.trim()) return toast("HTML обязателен для email-шаблона", "bad");
    if (channel === "push" && (!title.trim() || !body.trim())) return toast("Заголовок и текст обязательны для push-шаблона", "bad");
    if (channel === "sms" && !body.trim()) return toast("Текст обязателен для SMS-шаблона", "bad");

    setBusy(true);
    const row = {
      name: name.trim(),
      folder_id: folderId || null,
      subject: channel === "email" ? subject.trim() || null : null,
      html: channel === "email" ? html : null,
      title: channel === "push" ? title.trim() : null,
      body: channel === "push" || channel === "sms" ? body : null,
      url: channel === "push" ? url.trim() || null : null,
      icon_url: channel === "push" ? iconUrl.trim() || null : null,
      image_url: channel === "push" ? imageUrl.trim() || null : null,
      badge_url: channel === "push" ? badgeUrl.trim() || null : null,
      actions: channel === "push" ? actions.filter((a) => a.title.trim() && a.url.trim()).slice(0, 2) : [],
    };
    const { error } = await supabase.from("templates").update(row).eq("id", template.id);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Сохранено", "good");
    router.push(`/admin/projects/${projectId}/templates`);
    router.refresh();
  }

  async function remove() {
    const ok = await confirm({
      title: "Удалить шаблон?",
      message: "Уже отправленные с ним рассылки не изменятся.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    await supabase.from("templates").delete().eq("id", template.id);
    setBusy(false);
    toast("Удалено", "good");
    router.push(`/admin/projects/${projectId}/templates`);
    router.refresh();
  }

  const segments = smsSegments(body);

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Редактирование шаблона</h1>

      <div className="mt-4">
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            <Badge tone="accent">{CHANNEL_LABEL[channel]}</Badge>
            <span className="text-[12px] text-ink-faint">канал нельзя изменить после создания</span>
          </div>

          <div>
            <Label>
              Название <span className="text-bad">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Скидка недели»" required />
          </div>

          <div>
            <Label>Папка</Label>
            <CustomSelect
              value={folderId}
              onChange={setFolderId}
              options={[{ value: "", label: "Без папки" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
              className="w-full"
              ariaLabel="Папка"
            />
          </div>

          <ContextField enabled={contextEnabled} onToggle={setContextEnabled} value={contextJson} onChange={setContextJson} error={contextError} />

          {channel === "email" && (
            <>
              <div>
                <Label>Тема письма</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Можно переопределить при отправке" />
              </div>
              <div>
                <Label>
                  HTML <span className="text-bad">*</span>
                </Label>
                <Textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                  placeholder="<p>Привет, {{ name }}!</p>"
                  required
                />
                {!hasUnsubscribeTag(html) && (
                  <p className="text-[11px] text-ink-faint text-right mt-1 mb-0">
                    Для маркетинговой рассылки понадобится ссылка отписки — добавьте <code>{'<a href="{{ unsubscribe_url }}">Отписаться</a>'}</code>
                  </p>
                )}
              </div>
            </>
          )}

          {channel === "push" && (
            <>
              <div>
                <Label>
                  Заголовок <span className="text-bad">*</span>
                </Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Скидка {{ percent }}%!" required maxLength={80} />
                <p className="text-[11px] text-ink-faint text-right mt-1 mb-0">{80 - title.length} символов осталось</p>
              </div>
              <div>
                <Label>
                  Текст <span className="text-bad">*</span>
                </Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  maxLength={200}
                  placeholder="Привет, {{ name }}! Успей до конца недели."
                  required
                />
                <p className="text-[11px] text-ink-faint text-right mt-1 mb-0">{200 - body.length} символов осталось</p>
              </div>
              <div>
                <Label>Ссылка при клике</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label>URL иконки</Label>
                  <Input value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://..." />
                </div>
                <div className="flex-1">
                  <Label>URL картинки</Label>
                  <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
                </div>
                <div className="flex-1">
                  <Label>URL значка</Label>
                  <Input value={badgeUrl} onChange={(e) => setBadgeUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>
              <div>
                <Label>Кнопки действий</Label>
                {actions.map((a, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <Input
                      value={a.title}
                      onChange={(e) => setActions((as) => as.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                      placeholder="Текст кнопки"
                      maxLength={30}
                    />
                    <Input
                      value={a.url}
                      onChange={(e) => setActions((as) => as.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                      placeholder="https://..."
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={() => setActions((as) => as.filter((_, j) => j !== i))}>
                      <IconX size={15} stroke={2} />
                    </Button>
                  </div>
                ))}
                {actions.length < 2 && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setActions((as) => [...as, { title: "", url: "" }])}>
                    <IconPlus size={15} stroke={2} />
                    Кнопка
                  </Button>
                )}
              </div>
            </>
          )}

          {channel === "sms" && (
            <div>
              <Label>
                Текст сообщения <span className="text-bad">*</span>
              </Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={400} placeholder="Привет, {{ name }}! Ваш код: {{ code }}" required />
              <p className="text-[11px] text-ink-faint text-right mt-1 mb-0">
                {body.length} символов · {segments.encoding} · {segments.count || 1} SMS
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
            <Button type="button" variant="secondary" onClick={() => setPreviewOpen(true)}>
              <IconEye size={15} stroke={1.8} />
              Превью
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/templates`)}>
              Отмена
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={remove} className="ml-auto">
              Удалить
            </Button>
          </div>
        </form>
      </div>

      {previewOpen && (
        <MessagePreviewModal label={name || "Превью"} content={previewContent} sampleData={contextData} onClose={() => setPreviewOpen(false)} />
      )}
    </main>
  );
}
