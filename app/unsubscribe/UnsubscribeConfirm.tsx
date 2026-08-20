"use client";

import { useState } from "react";
import { Button } from "@/app/ui";

export default function UnsubscribeConfirm({ projectId, email, token }: { projectId: string; email: string; token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function confirm() {
    setState("busy");
    const res = await fetch("/api/public/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p: projectId, e: email, t: token }),
    });
    setState(res.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <main className="max-w-md mx-auto mt-24 text-center px-4">
        <h1 className="text-xl font-semibold text-ink">Вы отписаны</h1>
        <p className="text-ink-muted mt-2">{email} больше не будет получать email-рассылки от этого отправителя.</p>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto mt-24 text-center px-4">
      <h1 className="text-xl font-semibold text-ink">Отписаться от рассылки?</h1>
      <p className="text-ink-muted mt-2">
        <span className="text-ink">{email}</span> перестанет получать email-рассылки. Это действие можно отменить только повторной подпиской на сайте.
      </p>
      <Button className="mt-6" disabled={state === "busy"} onClick={confirm}>
        {state === "busy" ? "Отписываем…" : "Отписаться"}
      </Button>
      {state === "error" && <p className="text-bad text-[13px] mt-3">Ссылка недействительна или устарела.</p>}
    </main>
  );
}
