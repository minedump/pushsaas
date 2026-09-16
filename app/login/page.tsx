"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconBell } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Checkbox, Input, Label, Card } from "@/app/ui";
import { friendlyError } from "@/lib/errors";

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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consentPersonalData, setConsentPersonalData] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !name.trim()) {
      setError("Укажите имя");
      return;
    }
    if (mode === "signup" && !consentPersonalData) {
      setError("Нужно согласие на обработку персональных данных и политику конфиденциальности");
      return;
    }
    setBusy(true);
    setError(null);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: name.trim(),
                // Тот же момент, что и сама регистрация — обе обязательные
                // галочки идут одной строкой в форме, поэтому и согласие
                // на обработку данных, и на политику конфиденциальности
                // фиксируются одинаковым флагом (см. handle_new_user в
                // supabase/migrations/0094_signup_consents.sql).
                consent_personal_data: consentPersonalData,
                consent_privacy_policy: consentPersonalData,
                consent_marketing: consentMarketing,
              },
            },
          });
    const { error } = await fn;
    setBusy(false);
    if (error) {
      setError(friendlyError(error, mode === "signin" ? "Не удалось войти" : "Не удалось зарегистрироваться"));
      return;
    }
    router.push(params.get("next") || "/admin");
    router.refresh();
  }

  return (
    <main className="max-w-sm mx-auto mt-20 px-5">
      {/* Тот же brand-локап, что в ките (раздел «Логотип») — из двух
          показанных там размеров взят крупный (24px/700, 28px значок);
          компактный 16px/20px — тот, что использует шапка панели
          (AdminShell.tsx). Здесь эта строка играет роль заголовка страницы,
          поэтому крупнее уместнее. */}
      <div className="flex items-center gap-2 font-bold text-2xl text-ink mb-7">
        <IconBell size={28} stroke={1.8} className="text-accent" />
        SENDERA
      </div>

      <Card>
        <form onSubmit={submit}>
          {/* Тот же размер, что у заголовка модалки (Modal.tsx: `text-base
              font-semibold m-0`) — эта форма визуально то же окно с полями,
              просто без затемнения вокруг, поэтому и заголовок того же ранга. */}
          <h1 className="text-base font-semibold m-0 mb-4">{mode === "signin" ? "Вход в панель управления" : "Регистрация"}</h1>
          {mode === "signup" && (
            <>
              <Label>Имя</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              <div className="h-3.5" />
            </>
          )}
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

          {mode === "signup" && (
            <div className="flex flex-col gap-2.5 mt-4">
              <Checkbox
                checked={consentPersonalData}
                onChange={setConsentPersonalData}
                label={
                  <span className="text-ink-muted">
                    Согласен с{" "}
                    <a href="/legal/privacy" target="_blank" className="text-accent hover:underline">
                      политикой конфиденциальности
                    </a>{" "}
                    и даю{" "}
                    <a href="/legal/personal-data" target="_blank" className="text-accent hover:underline">
                      согласие на обработку персональных данных
                    </a>
                  </span>
                }
              />
              <Checkbox
                checked={consentMarketing}
                onChange={setConsentMarketing}
                label={<span className="text-ink-muted">Хочу получать новости и предложения по email</span>}
              />
            </div>
          )}

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
