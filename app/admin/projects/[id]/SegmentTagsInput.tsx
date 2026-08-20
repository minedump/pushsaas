"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { Badge, cn } from "@/app/ui";

// Мультивыбор тегов сегмента — выбранные оседают внутри поля бейджами,
// набор символов фильтрует список уже встречавшихся в проекте тегов
// (подсказка, а не ограничение — можно ввести и совсем новый тег).
export function SegmentTagsInput({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  options: string[];
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function addTag(raw: string) {
    const t = raw.trim().toLowerCase();
    if (t && !value.includes(t)) onChange([...value, t]);
    setInput("");
  }
  function removeTag(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    return options.filter((o) => !value.includes(o) && (!q || o.toLowerCase().includes(q))).slice(0, 8);
  }, [options, value, input]);

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 w-full min-h-[38px] px-2.5 py-1.5 rounded-lg border border-border bg-surface transition-colors",
          disabled ? "opacity-60" : "focus-within:border-accent-line focus-within:ring-2 focus-within:ring-accent-line"
        )}
      >
        {value.map((t) => (
          <Badge key={t} tone="accent">
            {t}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="flex items-center border-none bg-transparent cursor-pointer text-inherit p-0 ml-0.5 opacity-70 hover:opacity-100"
                aria-label={`Убрать тег ${t}`}
              >
                <IconX size={12} stroke={2.5} />
              </button>
            )}
          </Badge>
        ))}
        <input
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag(input);
            } else if (e.key === "Backspace" && !input && value.length) {
              removeTag(value[value.length - 1]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={value.length ? "" : "Тег и Enter — пусто = всем"}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      {open && !disabled && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1.5 max-h-56 overflow-auto rounded-lg border border-border bg-surface shadow-lg py-1"
          style={{ animation: "ui-pop .12s ease-out" }}
        >
          {suggestions.map((o) => (
            <li key={o} role="option">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(o)}
                className="flex items-center w-full text-left text-sm px-3 py-2 cursor-pointer text-ink hover:bg-surface-2"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
