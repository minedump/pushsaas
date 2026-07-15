"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Card } from "@/app/ui";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(params.get("next") || "/admin");
    router.refresh();
  }

  return (
    <main className="max-w-sm mx-auto mt-20 px-5">
      <h1 className="text-2xl font-semibold mb-1">PushSaaS</h1>
      <p className="text-ink-muted mt-0 mb-7">
        {mode === "signin" ? "Вход в панель управления" : "Регистрация"}
      </p>

      <Card>
        <form onSubmit={submit}>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <div className="h-3.5" />
          <Label>Пароль</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
          {error && <p className="text-bad text-[13px] mt-3.5">{error}</p>}
          <Button className="w-full mt-5" disabled={busy}>
            {busy ? "…" : mode === "signin" ? "Войти" : "Зарегистрироваться"}
          </Button>
        </form>
      </Card>

      <p className="text-center mt-4 text-sm">
        {mode === "signin" ? "Нет аккаунта? " : "Уже есть аккаунт? "}
        <a
          href="#"
          className="text-accent"
          onClick={(e) => {
            e.preventDefault();
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
        >
          {mode === "signin" ? "Создать" : "Войти"}
        </a>
      </p>
    </main>
  );
}
