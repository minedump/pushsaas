"use client";

import { useState } from "react";
import {
  IconCircleCheck,
  IconAlertCircle,
  IconCircleDashed,
  IconRefresh,
  IconPlus,
  IconMinus,
} from "@tabler/icons-react";
import { cn } from "@/app/ui";

type CheckItem = { label: string; ok: boolean; note?: string };

// Раскрывающаяся карточка шага подключения. В шапке: статус-иконка, название,
// иконка «проверить» и +/−. В теле: содержимое шага + результаты проверки
// уведомлением. Отдельной кнопки «Проверить» и слова «Готово» нет.
export default function SetupStep({
  projectId,
  step,
  title,
  initialOk,
  children,
}: {
  projectId: string;
  step: "sw" | "snippet" | "manifest";
  title: string;
  initialOk: boolean;
  children: React.ReactNode;
}) {
  const [ok, setOk] = useState<boolean | null>(initialOk ? true : null);
  const [open, setOpen] = useState(!initialOk); // выполненные — свёрнуты
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<CheckItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    setOpen(true);
    try {
      const res = await fetch("/api/admin/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, step }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Ошибка проверки");
        setOk(null);
      } else {
        setOk(json.ok);
        setChecks(json.checks);
      }
    } catch {
      setError("Не удалось выполнить проверку");
    }
    setBusy(false);
  }

  const StatusIcon =
    ok === true ? (
      <IconCircleCheck size={20} stroke={2} className="text-good shrink-0" />
    ) : ok === false ? (
      <IconAlertCircle size={20} stroke={2} className="text-bad shrink-0" />
    ) : (
      <IconCircleDashed size={20} stroke={2} className="text-ink-faint shrink-0" />
    );

  return (
    <div className="bg-surface border border-border rounded-xl mt-3">
      <div
        className="flex items-center gap-2.5 p-4 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        {StatusIcon}
        <span className="flex-1 font-semibold text-sm">{title}</span>
        <button
          onClick={verify}
          disabled={busy}
          title="Проверить"
          className="p-1.5 rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          <IconRefresh size={17} stroke={1.8} className={busy ? "animate-spin" : ""} />
        </button>
        <span className="p-1.5 text-ink-muted">
          {open ? <IconMinus size={17} stroke={2} /> : <IconPlus size={17} stroke={2} />}
        </span>
      </div>

      {open && (
        <div className="px-4 pb-4">
          {children}

          {error && (
            <div className="mt-3 rounded-lg p-3 bg-bad-tint border border-border text-bad text-[13px]">{error}</div>
          )}

          {checks && (
            <div
              className={cn(
                "mt-3 rounded-lg p-3 border border-border",
                ok ? "bg-good-tint" : "bg-warn-tint"
              )}
            >
              <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                {checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px]">
                    {c.ok ? (
                      <IconCircleCheck size={15} stroke={2} className="text-good shrink-0 mt-0.5" />
                    ) : (
                      <IconAlertCircle size={15} stroke={2} className="text-bad shrink-0 mt-0.5" />
                    )}
                    <span className={c.ok ? "text-ink-muted" : "text-ink"}>
                      {c.label}
                      {c.note && <span className="text-ink-faint"> — {c.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
