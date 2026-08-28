"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, useDialogs } from "@/app/ui";
import { friendlyError } from "@/lib/errors";

export default function EditName({ initialName, email }: { initialName: string | null; email: string }) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useDialogs();
  const [name, setName] = useState(initialName || "");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast("Укажите имя", "bad");
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", user!.id);
    setBusy(false);
    if (error) return toast(friendlyError(error), "bad");
    toast("Имя обновлено", "good");
    router.refresh();
  }

  return (
    <form onSubmit={save}>
      <Label>Имя</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} required className="w-full" />
      <div className="mt-4">
        <Label>Email</Label>
        <Input value={email} disabled className="w-full" />
      </div>
      <Button disabled={busy} className="mt-4">
        {busy ? "…" : "Сохранить"}
      </Button>
    </form>
  );
}
