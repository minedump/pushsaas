"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label, useDialogs } from "@/app/ui";

export default function ChangePassword() {
  const supabase = createClient();
  const { toast } = useDialogs();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) toast(error.message, "bad");
    else {
      toast("Пароль обновлён", "good");
      setPassword("");
    }
  }

  return (
    <Card className="mt-3">
      <form onSubmit={submit}>
        <Label>Новый пароль</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        <Button className="mt-4" disabled={busy}>
          {busy ? "…" : "Обновить"}
        </Button>
      </form>
    </Card>
  );
}
