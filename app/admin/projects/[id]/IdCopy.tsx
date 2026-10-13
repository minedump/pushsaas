"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useCopy } from "@/app/ui";

// Компактный ID сущности с копированием в буфер — тот же вид, что и её ID,
// используемый при вызовах публичного API (templateId и т.п.).
export function IdCopy({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCopy();
  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await copy(id, "ID скопирован"))) return;
        setCopied(true);
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
