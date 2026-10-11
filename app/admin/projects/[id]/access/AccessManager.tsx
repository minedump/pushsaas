"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, useDialogs } from "@/app/ui";

type Person = { userId: string; email: string; name: string | null };
type Member = Person & { createdAt: string };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function AccessManager({
  projectId,
  currentUserId,
  canTransfer,
  owner,
  initialMembers,
}: {
  projectId: string;
  currentUserId: string;
  canTransfer: boolean;
  owner: Person;
  initialMembers: Member[];
}) {
  const router = useRouter();
  const { confirm, toast } = useDialogs();
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/projects/members/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, email }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Не удалось выдать доступ");
      return;
    }
    setMembers((list) => [...list, json.member]);
    setEmail("");
    toast("Доступ выдан", "good");
  }

  async function remove(m: Member) {
    if (busy) return;
    const isSelf = m.userId === currentUserId;
    const ok = await confirm({
      title: isSelf ? "Покинуть проект?" : "Забрать доступ?",
      message: isSelf
        ? "Проект пропадёт из вашего списка. Вернуть доступ сможет владелец или другой Админ."
        : `${m.email} потеряет доступ к проекту. Вернуть его можно в любой момент.`,
      confirmText: isSelf ? "Покинуть" : "Забрать доступ",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/admin/projects/members/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, userId: m.userId }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(json.error || "Не удалось забрать доступ", "bad");
    if (json.left) {
      // полная перезагрузка, чтобы шапка перечитала список проектов
      window.location.href = "/admin";
      return;
    }
    setMembers((list) => list.filter((x) => x.userId !== m.userId));
    toast("Доступ закрыт", "good");
    router.refresh();
  }

  async function transfer(m: Member) {
    if (busy) return;
    const ok = await confirm({
      title: "Передать проект?",
      message: `${m.name || m.email} станет владельцем проекта. Прежний владелец останется Админом. Тариф и привязанная карта остаются в проекте.`,
      confirmText: "Передать проект",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/admin/projects/members/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, userId: m.userId }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(json.error || "Не удалось передать проект", "bad");
    // полная перезагрузка: меняются роли, кнопки и список проектов в шапке
    window.location.reload();
  }

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold m-0">Доступ</h1>

      <Card className="mt-4 sm:mt-8">
        <div className="text-base font-semibold mb-1">Выдать доступ</div>
        <p className="text-[13px] text-ink-muted mt-0 mb-3">
          Введите email человека, который уже зарегистрирован в SENDERA. Проект появится у него в списке сразу.
        </p>
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1 min-w-0">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.ru"
              required
              autoComplete="off"
              aria-label="Email"
            />
            {error && <p className="text-bad text-[13px] mt-1.5 mb-0">{error}</p>}
          </div>
          <Button disabled={busy}>Выдать доступ</Button>
        </form>
      </Card>

      <Card className="mt-3">
        <div className="text-base font-semibold mb-3">Участники</div>
        <ul className="list-none p-0 m-0 flex flex-col divide-y divide-border">
          <li className="flex items-center gap-3 py-3 first:pt-0">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{owner.name || owner.email}</div>
              {owner.name && <div className="text-[13px] text-ink-muted truncate">{owner.email}</div>}
            </div>
            <span className="text-[12.5px] font-semibold px-2.5 py-0.5 rounded-full bg-accent-tint text-accent">Владелец</span>
          </li>
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 py-3 last:pb-0">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {m.name || m.email}
                  {m.userId === currentUserId && <span className="text-ink-faint font-normal"> (вы)</span>}
                </div>
                <div className="text-[13px] text-ink-muted truncate">
                  {m.name ? `${m.email} · ` : ""}с {fmtDate(m.createdAt)}
                </div>
              </div>
              <span className="text-[12.5px] font-semibold px-2.5 py-0.5 rounded-full bg-surface-2 text-ink-muted">Админ</span>
              {canTransfer && (
                <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => transfer(m)}>
                  Сделать владельцем
                </Button>
              )}
              <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => remove(m)}>
                {m.userId === currentUserId ? "Покинуть проект" : "Забрать доступ"}
              </Button>
            </li>
          ))}
        </ul>
        {members.length === 0 && <p className="text-[13px] text-ink-faint mt-3 mb-0">Кроме владельца, доступ пока ни у кого нет.</p>}
      </Card>
    </main>
  );
}
