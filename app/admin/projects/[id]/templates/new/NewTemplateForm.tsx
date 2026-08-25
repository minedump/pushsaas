"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconEye, IconX, IconPlus } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, CustomSelect, Input, Label, Textarea, useDialogs } from "@/app/ui";
import { MessagePreviewModal, type PreviewContent } from "../../MessagePreviewModal";
import { ContextField } from "../../ContextField";
import { ContextDocs } from "../ContextDocs";
import { smsSegments } from "@/lib/smsSegments";

type Channel = "push" | "sms" | "email";
type Folder = { id: string; name: string };

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "push", label: "Push" },
  { value: "sms", label: "SMS" },
];

export default function NewTemplateForm({
  projectId,
  folders,
  initialChannel,
  initialFolderId,
}: {
  projectId: string;
  folders: Folder[];
  initialChannel?: Channel;
  initialFolderId?: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useDialogs();

  const [channel, setChannel] = useState<Channel>(initialChannel || "email");
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState(initialFolderId && folders.some((f) => f.id === initialFolderId) ? initialFolderId : "");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [badgeUrl, setBadgeUrl] = useState("");
  const [actions, setActions] = useState<{ title: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [contextEnabled, setContextEnabled] = useState(false);
  const [contextJson, setContextJson] = useState("");

  // Контекст шаблона — сохраняется вместе с шаблоном (передаётся ПРИ КАЖДОЙ
  // отправке этим шаблоном, см. lib/sender.ts resolvePushTemplate/
  // resolveChannelTemplate) как дефолтные Liquid-данные; реальные данные
  // контакта/разового вызова перекрывают его при совпадении ключа.
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
    if (contextEnabled && contextError) return toast(contextError, "bad");

    setBusy(true);
    const row = {
      project_id: projectId,
      name: name.trim(),
      channel,
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
      context: contextData || null,
    };
    const { error } = await supabase.from("templates").insert(row);
    setBusy(false);
    if (error) return toast(error.message, "bad");
    toast("Шаблон создан", "good");
    router.push(`/admin/projects/${projectId}/templates`);
    router.refresh();
  }

  const segments = smsSegments(body);

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Новый шаблон</h1>

      <div className="mt-4">
        <form onSubmit={save} className="flex flex-col gap-3">
          <div>
            <Label>
              Название <span className="text-bad">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Скидка недели»" required />
          </div>

          <div>
            <Label>Канал</Label>
            <CustomSelect value={channel} onChange={(v) => setChannel(v as Channel)} options={CHANNEL_OPTIONS} className="w-full" ariaLabel="Канал" />
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
          <ContextDocs />

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
            <Button disabled={busy}>{busy ? "Создаём…" : "Создать"}</Button>
            <Button type="button" variant="secondary" onClick={() => setPreviewOpen(true)}>
              <IconEye size={15} stroke={1.8} />
              Превью
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push(`/admin/projects/${projectId}/templates`)}>
              Отмена
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
