"use client";

import { useState } from "react";
import { IconCircleCheck, IconCircleDashed, IconPlus, IconMinus } from "@tabler/icons-react";
import { Badge } from "@/app/ui";

// Тот же визуальный каркас, что у SetupStep (шаги подключения пушей):
// статус-иконка + заголовок + сворачивание. Без кнопки «Проверить» — для
// интеграций (SMS/Telegram/Email провайдеры) нет живой проверки токена без
// реальной отправки, только факт «ключ сохранён».
export default function IntegrationCard({
  title,
  badges,
  configured,
  defaultOpen,
  children,
}: {
  title: string;
  badges?: string[];
  configured: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? !configured);

  return (
    <div className="bg-surface border border-border rounded-xl mt-3">
      <div className="flex items-center gap-2.5 p-4 cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        {configured ? (
          <IconCircleCheck size={20} stroke={2} className="text-good shrink-0" />
        ) : (
          <IconCircleDashed size={20} stroke={2} className="text-ink-faint shrink-0" />
        )}
        <span className="flex-1 flex items-center gap-2 font-semibold text-sm">
          {title}
          {badges?.map((b) => (
            <Badge key={b} tone="neutral">
              {b}
            </Badge>
          ))}
        </span>
        <span className="p-1.5 text-ink-muted">{open ? <IconMinus size={17} stroke={2} /> : <IconPlus size={17} stroke={2} />}</span>
      </div>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
