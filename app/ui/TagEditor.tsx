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
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((t) => (
        <Badge key={t} tone="accent">
          {t}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="flex items-center border-none bg-transparent cursor-pointer text-inherit p-0 ml-0.5 opacity-70 hover:opacity-100"
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
        className="border border-dashed border-border rounded-full px-2 py-0.5 text-xs bg-transparent text-ink w-[70px] focus:outline-none focus:border-accent"
      />
    </div>
  );
}
