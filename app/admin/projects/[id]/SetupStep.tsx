"use client";

import { useState } from "react";
import { IconCircleCheck, IconCircleDashed, IconRefresh, IconPlus, IconMinus } from "@tabler/icons-react";
import { useDialogs } from "@/app/ui";

// Последний сохранённый результат проверки шага (projects.setup_checks).
export type SavedCheck = { ok?: boolean; checked_at?: string };

// Раскрывающаяся карточка шага подключения. В шапке: статус-иконка, название,
// иконка «проверить» и +/−. Итог проверки — только тост «прошла / не прошла»
// без подробностей, а в шапке остаётся галочка у пройденного шага.
export default function SetupStep({
  projectId,
  step,
  title,
  initial,
  children,
}: {
  projectId: string;
  step: "sw" | "snippet" | "manifest";
  title: string;
  initial?: SavedCheck;
  children: React.ReactNode;
}) {
  const { toast } = useDialogs();
  const [ok, setOk] = useState(initial?.ok === true);
  const [open, setOpen] = useState(initial?.ok !== true); // выполненные — свёрнуты
  const [busy, setBusy] = useState(false);

  async function verify(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, step }),
      });
      const json = await res.json().catch(() => ({}));
      const passed = res.ok && json.ok === true;
      // сбой самой проверки (нет доступа, нет домена, сеть) — не итог по шагу,
      // прежняя галочка остаётся; итог пользователю в любом случае один из двух
      if (res.ok) setOk(passed);
      toast(passed ? "Проверка пройдена" : "Проверка не пройдена", passed ? "good" : "bad");
    } catch {
      toast("Проверка не пройдена", "bad");
    }
    setBusy(false);
  }

  return (
    <div className="bg-surface border border-border rounded-xl mt-3">
      <div
        className="flex items-center gap-2.5 p-4 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        {ok ? (
          <IconCircleCheck size={20} stroke={2} className="text-good shrink-0" />
        ) : (
          <IconCircleDashed size={20} stroke={2} className="text-ink-faint shrink-0" />
        )}
        <span className="flex-1 font-semibold text-sm">{title}</span>
        <button
          onClick={verify}
          disabled={busy}
          title="Проверить"
          className="p-1.5 rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          <IconRefresh size={17} stroke={1.8} className={busy ? "animate-spin" : ""} />
        </button>
        <span className="p-1.5 text-ink-muted">
          {open ? <IconMinus size={17} stroke={2} /> : <IconPlus size={17} stroke={2} />}
        </span>
      </div>

      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
