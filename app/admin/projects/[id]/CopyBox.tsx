"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/app/ui";

export default function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2 items-start bg-surface-2 border border-border rounded-lg px-3 py-2.5 my-2.5">
      <code className="flex-1 min-w-0 text-[13px] whitespace-pre-wrap break-all font-mono leading-relaxed">{text}</code>
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <IconCheck size={15} stroke={2} /> : <IconCopy size={15} stroke={1.8} />}
        {copied ? "Скопировано" : "Копировать"}
      </Button>
    </div>
  );
}
