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
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">Новый проект</h1>

      <Card className="mt-4 sm:mt-8">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <Label>Название</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Мой магазин" />
          </div>
          <div>
            <Label>Домен сайта</Label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="myshop.ru" />
          </div>
          {error && <p className="text-bad text-[13px] m-0">{error}</p>}
          <div className="flex gap-2">
            <Button disabled={busy}>{busy ? "Создаём…" : "Создать проект"}</Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/admin")}>
              Отмена
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
