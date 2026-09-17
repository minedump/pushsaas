"use client";

import { useState } from "react";
import { IconX } from "@tabler/icons-react";
import { Badge } from "./Badge";

export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("");
  function add() {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput("");
  }
  return (
    <div className="w-full flex flex-wrap items-center gap-1.5 min-h-[38px] rounded-xl border border-border bg-surface px-2.5 py-1.5 focus-within:outline-none focus-within:ring-2 focus-within:ring-accent-line">
      {tags.map((t) => (
        <Badge key={t} tone="accent">
          <span className="inline-block -translate-y-px">{t}</span>
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="flex items-center border-none bg-transparent cursor-pointer text-inherit p-0 ml-0.5 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="удалить тег"
          >
            <IconX size={12} stroke={2.5} />
          </button>
        </Badge>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="+ тег"
        className="flex-1 min-w-[70px] border-0 outline-none bg-transparent text-sm text-ink placeholder:text-ink-faint"
      />
    </div>
  );
}
