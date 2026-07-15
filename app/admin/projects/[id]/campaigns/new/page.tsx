"use client";

import { useState, use } from "react";
import { IconX, IconPlus } from "@tabler/icons-react";
import { Button, Input, Textarea, Label, Card, Checkbox, useDialogs } from "@/app/ui";

export default function NewCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useDialogs();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState("");
  const [segment, setSegment] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [actions, setActions] = useState<{ title: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const segmentTags = segment.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const res = await fetch("/api/admin/campaigns/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: id, title, message, url, icon, segmentTags,
        scheduledAt: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        actions: actions.filter((a) => a.title.trim() && a.url.trim()),
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Ошибка отправки");
      return;
    }
    if (json.scheduled) {
      const msg = `Запланировано на ${new Date(json.at).toLocaleString("ru-RU")}`;
      setResult(msg);
      toast(msg, "good");
    } else {
      const msg = `Доставлено ${json.delivered} из ${json.total}, ошибок ${json.failed}`;
      setResult(msg);
      toast(msg, "good");
    }
  }

  return (
    <main className="max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold">Новое уведомление</h1>

      <Card className="mt-4">
        <form onSubmit={send}>
          <Label>Заголовок</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} placeholder="Скидка 20% сегодня" />
          <div className="h-3.5" />
          <Label>Текст</Label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={3} maxLength={200} placeholder="Только до конца дня…" />
          <div className="h-3.5" />
          <Label>Ссылка при клике (необязательно)</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ваш-сайт/акция" />
          <div className="h-3.5" />
          <Label>URL иконки (необязательно)</Label>
          <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="https://ваш-сайт/icon-192.png" />
          <div className="h-3.5" />
          <Label>Сегмент по тегам (необязательно, через запятую)</Label>
          <Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="vip, moscow — пусто = всем" />
          <div className="h-4" />

          <Label>Кнопки действий (необязательно, до 2 — rich push)</Label>
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setActions((as) => [...as, { title: "", url: "" }])}
            >
              <IconPlus size={15} stroke={2} />
              Кнопка
            </Button>
          )}
          <div className="h-4" />
          <Checkbox checked={schedule} onChange={setSchedule} label="Запланировать на потом" />
          {schedule && (
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-2.5" required />
          )}

          {error && <p className="text-bad text-[13px] mt-3.5">{error}</p>}
          {result && <p className="text-good text-sm mt-3.5">{result}</p>}

          <Button className="mt-5" disabled={busy}>
            {busy ? "Отправляем…" : schedule ? "Запланировать" : "Отправить всем подписчикам"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
