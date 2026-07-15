"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Card } from "@/app/ui";

export default function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/projects/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, domain }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Ошибка");
      return;
    }
    router.push(`/admin/projects/${json.id}`);
    router.refresh();
  }

  return (
    <main className="max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold">Новый проект</h1>
      <p className="text-ink-muted mt-0">
        Проект — это один сайт, на котором вы собираете подписчиков. Для него сгенерируется своя пара VAPID-ключей.
      </p>

      <Card className="mt-5">
        <form onSubmit={submit}>
          <Label>Название</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Мой магазин" />
          <div className="h-4" />
          <Label>Домен сайта (без https://)</Label>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yuliawave.com" />
          {error && <p className="text-bad text-[13px] mt-3.5">{error}</p>}
          <Button className="mt-5" disabled={busy}>
            {busy ? "Создаём…" : "Создать проект"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
