"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useDialogs } from "@/app/ui";

// Компактный ID сущности с копированием в буфер — тот же вид, что и её ID,
// используемый при вызовах публичного API (templateId и т.п.).
export function IdCopy({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useDialogs();
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        toast("ID скопирован", "good");
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 text-[11.5px] font-mono text-ink-faint hover:text-accent cursor-pointer"
      title="Скопировать ID для API"
    >
      {copied ? <IconCheck size={12} stroke={2} /> : <IconCopy size={12} stroke={1.8} />}
      {id}
    </button>
  );
}
