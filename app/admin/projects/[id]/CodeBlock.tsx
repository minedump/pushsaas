"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/app/ui";

// Многострочный блок кода с кнопкой копирования (сниппеты для вставки на сайт).
export default function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-2.5 rounded-xl border border-border bg-surface-2 overflow-hidden">
      {title && (
        <div className="px-4 pt-2.5 text-[11px] uppercase tracking-wider text-ink-faint">{title}</div>
      )}
      <pre className="m-0 px-4 py-3 pr-32 text-[12.5px] font-mono leading-relaxed whitespace-pre-wrap break-all">
        {code}
      </pre>
      <div className="absolute top-2 right-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <IconCheck size={15} stroke={2} /> : <IconCopy size={15} stroke={1.8} />}
          {copied ? "Скопировано" : "Копировать"}
        </Button>
      </div>
    </div>
  );
}
