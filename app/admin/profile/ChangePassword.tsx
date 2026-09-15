"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Label, PasswordInput, useDialogs } from "@/app/ui";
import { friendlyError } from "@/lib/errors";

export default function ChangePassword() {
  const supabase = createClient();
  const { toast } = useDialogs();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
          className="w-full"
        />

        <div className="mt-4">
          <Label>Подтвердите пароль</Label>
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={6}
            required
            className="w-full"
          />
        </div>

        <Button className="mt-4" disabled={busy}>
          {busy ? "…" : "Обновить"}
        </Button>
      </form>
    </Card>
  );
}
