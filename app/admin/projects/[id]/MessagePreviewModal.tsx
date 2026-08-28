"use client";

import { useEffect, useState } from "react";
import { IconX, IconBellRinging } from "@tabler/icons-react";
import { Badge, Modal } from "@/app/ui";
import { applyTemplate } from "@/lib/template";

export type PreviewChannel = "push" | "sms" | "email";

export type PreviewContent = {
  channel: PreviewChannel;
  // push
  title?: string | null;
  body?: string | null; // push text / sms text
  url?: string | null;
  icon_url?: string | null;
  image_url?: string | null;
  badge_url?: string | null;
  actions?: { title: string; url: string }[] | null;
  // email
  subject?: string | null;
  html?: string | null;
};

const CHANNEL_LABEL: Record<PreviewChannel, string> = { push: "Push", sms: "SMS", email: "Email" };

// Единый попап предпросмотра — используется и в списке шаблонов, и в форме
// создания/редактирования рассылки/шаблона (там показывает то, что сейчас
// набрано в полях, а не сохранённую запись). Вид зависит от канала: письмо
// рендерится как есть (iframe), push и sms — мокапом, похожим на реальную
// выдачу. Liquid ({{ }}/{% %}) реально рендерится (тем же applyTemplate,
// что и на отправке) с пустыми данными, необязательный sampleData
// подставляет конкретные значения для наглядности — так
// поведение фильтров/условий видно сразу, а не как сырой синтаксис.
export function MessagePreviewModal({
  label,
  content,
  sampleData,
  projectId,
  onClose,
}: {
  label: string;
  content: PreviewContent;
  sampleData?: Record<string, unknown>;
  // Если задан — products/product/categories/category/collections/collection
  // внутри sampleData (и sampleData.template) резолвятся против кеша фида
  // (см. app/api/admin/preview-context) — так превью показывает реальные
  // название/цену/картинку, а не голый {"id": "..."}, как при отправке.
  projectId?: string;
  onClose: () => void;
}) {
  const [resolvedSampleData, setResolvedSampleData] = useState(sampleData);
  useEffect(() => {
    if (!projectId || !sampleData) {
      setResolvedSampleData(sampleData);
      return;
    }
    let cancelled = false;
    fetch("/api/admin/preview-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, data: sampleData }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.data) setResolvedSampleData(json.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, JSON.stringify(sampleData)]);

  const data = resolvedSampleData || {};
  const rendered: PreviewContent = {
    ...content,
    title: applyTemplate(content.title, data),
    body: applyTemplate(content.body, data),
    subject: applyTemplate(content.subject, data),
    html: applyTemplate(content.html, data),
    url: content.url ? applyTemplate(content.url, data) : content.url,
    icon_url: content.icon_url ? applyTemplate(content.icon_url, data) : content.icon_url,
    image_url: content.image_url ? applyTemplate(content.image_url, data) : content.image_url,
    actions: content.actions?.length
      ? content.actions.map((a) => ({ title: applyTemplate(a.title, data), url: applyTemplate(a.url, data) }))
      : content.actions,
  };

  return (
    <Modal onClose={onClose} className="max-w-md max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-base font-semibold m-0 truncate">{label}</h3>
          <Badge tone="accent">{CHANNEL_LABEL[content.channel]}</Badge>
        </div>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
        {content.channel === "email" && (
          <div>
            {rendered.subject && <div className="text-[12.5px] text-ink-muted mb-2">Тема: {rendered.subject}</div>}
            <iframe srcDoc={rendered.html || ""} className="w-full h-96 border border-border rounded-lg bg-white" sandbox="" title="Превью письма" />
          </div>
        )}
        {content.channel === "push" && <PushPreview content={rendered} />}
        {content.channel === "sms" && <SmsPreview content={rendered} />}
      </div>
    </Modal>
  );
}

// Мокап браузерного push-уведомления — та же форма, что реально придёт
// подписчику (иконка, заголовок, текст, картинка-баннер).
function PushPreview({ content }: { content: PreviewContent }) {
  return (
    <div className="bg-[#e8e8ec] rounded-xl p-4">
      <div className="bg-white rounded-lg shadow-md p-3 flex gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#eef1f6] flex items-center justify-center shrink-0 overflow-hidden">
          {content.icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.icon_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <IconBellRinging size={20} stroke={1.6} className="text-[#8a8f9a]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#111] truncate">{content.title || "—"}</div>
          <div className="text-[12.5px] text-[#444] mt-0.5 whitespace-pre-wrap">{content.body || "—"}</div>
          {content.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={content.image_url} alt="" className="w-full rounded-md mt-2 max-h-40 object-cover" />
          )}
        </div>
      </div>
      {content.actions && content.actions.length > 0 && (
        <div className="flex gap-2 mt-2">
          {content.actions.map((a, i) => (
            <div key={i} className="flex-1 text-center text-[12px] text-[#1a73e8] bg-white rounded-md py-1.5 shadow-sm truncate px-2">
              {a.title || "—"}
            </div>
          ))}
        </div>
      )}
      {content.url && <div className="text-[11px] text-ink-faint mt-2 truncate">клик → {content.url}</div>}
    </div>
  );
}

// Мокап SMS — входящий пузырь сообщения, как в мессенджере.
function SmsPreview({ content }: { content: PreviewContent }) {
  return (
    <div className="bg-[#e5e5ea] rounded-xl p-4 min-h-[110px] flex flex-col justify-end">
      <div className="self-start max-w-[85%] bg-white rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13.5px] text-[#111] shadow-sm whitespace-pre-wrap">
        {content.body || "—"}
      </div>
    </div>
  );
}
