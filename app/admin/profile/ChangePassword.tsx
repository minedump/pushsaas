"use client";

import { useState } from "react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label, useDialogs } from "@/app/ui";
import { friendlyError } from "@/lib/errors";

export default function ChangePassword() {
  const supabase = createClient();
  const { toast } = useDialogs();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast("Пароли не совпадают", "bad");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) toast(friendlyError(error), "bad");
    else {
      toast("Пароль обновлён", "good");
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <Card className="mt-3">
      <form onSubmit={submit}>
        <Label>Новый пароль</Label>
        <div className="relative">
          <Input
            type={visible ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            className="w-full pr-9"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-ink-faint hover:text-ink cursor-pointer"
            title={visible ? "Скрыть пароли" : "Показать пароли"}
          >
            {visible ? <IconEyeOff size={16} stroke={1.8} /> : <IconEye size={16} stroke={1.8} />}
          </button>
        </div>

        <div className="mt-4">
          <Label>Подтвердите пароль</Label>
          <div className="relative">
            <Input
              type={visible ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={6}
              required
              className="w-full pr-9"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-ink-faint hover:text-ink cursor-pointer"
              title={visible ? "Скрыть пароли" : "Показать пароли"}
            >
              {visible ? <IconEyeOff size={16} stroke={1.8} /> : <IconEye size={16} stroke={1.8} />}
            </button>
          </div>
        </div>

        <Button className="mt-4" disabled={busy}>
          {busy ? "…" : "Обновить"}
        </Button>
      </form>
    </Card>
  );
}
