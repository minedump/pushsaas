"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Button } from "./Button";
import { Input } from "./Input";
import { cn } from "./cn";

type Tone = "neutral" | "good" | "bad" | "warn";

type ConfirmOpts = { title: string; message?: string; confirmText?: string; cancelText?: string; danger?: boolean };
type PromptOpts = { title: string; message?: string; defaultValue?: string; placeholder?: string; confirmText?: string };

type Dialog =
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOpts)
  | ({ kind: "prompt"; resolve: (v: string | null) => void } & PromptOpts)
  | null;

type Toast = { id: string; message: string; tone: Tone };

type DialogsApi = {
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  prompt: (o: PromptOpts) => Promise<string | null>;
  toast: (message: string, tone?: Tone) => void;
};

const Ctx = createContext<DialogsApi | null>(null);

export function useDialogs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDialogs must be used within <DialogProvider>");
  return ctx;
}

const toastTone: Record<Toast["tone"], string> = {
  neutral: "bg-surface border-border text-ink",
  good: "bg-good-tint border-good text-good",
  bad: "bg-bad-tint border-bad text-bad",
  warn: "bg-warn-tint border-warn text-warn",
};

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [promptValue, setPromptValue] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ kind: "confirm", resolve, ...o })),
    []
  );
  const prompt = useCallback(
    (o: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setPromptValue(o.defaultValue ?? "");
        setDialog({ kind: "prompt", resolve, ...o });
      }),
    []
  );
  const toast = useCallback((message: string, tone: Tone = "neutral") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  function resolveConfirm(v: boolean) {
    if (dialog?.kind === "confirm") dialog.resolve(v);
    setDialog(null);
  }
  function resolvePrompt(v: string | null) {
    if (dialog?.kind === "prompt") dialog.resolve(v);
    setDialog(null);
  }
  function cancel() {
    if (dialog?.kind === "confirm") dialog.resolve(false);
    if (dialog?.kind === "prompt") dialog.resolve(null);
    setDialog(null);
  }

  return (
    <Ctx.Provider value={{ confirm, prompt, toast }}>
      {children}

      {dialog && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"
          style={{ animation: "ui-fade .12s ease-out" }}
          onMouseDown={(e) => e.target === e.currentTarget && cancel()}
        >
          <div
            className="w-full max-w-sm bg-surface border border-border rounded-2xl p-5 shadow-2xl"
            style={{ animation: "ui-pop .16s ease-out" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter" && dialog.kind === "prompt") resolvePrompt(promptValue);
            }}
          >
            <h3 className="text-base font-semibold m-0">{dialog.title}</h3>
            {dialog.message && <p className="text-sm text-ink-muted mt-2 mb-0">{dialog.message}</p>}

            {dialog.kind === "prompt" && (
              <Input
                autoFocus
                value={promptValue}
                placeholder={dialog.placeholder}
                onChange={(e) => setPromptValue(e.target.value)}
                className="mt-3"
              />
            )}

            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" size="sm" onClick={cancel}>
                {dialog.kind === "confirm" ? dialog.cancelText ?? "Отмена" : "Отмена"}
              </Button>
              <Button
                variant={dialog.kind === "confirm" && dialog.danger ? "danger" : "primary"}
                size="sm"
                autoFocus={dialog.kind === "confirm"}
                onClick={() => (dialog.kind === "confirm" ? resolveConfirm(true) : resolvePrompt(promptValue))}
              >
                {dialog.kind === "confirm" ? dialog.confirmText ?? "OK" : dialog.confirmText ?? "OK"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* toasts */}
      <div className="fixed bottom-4 right-4 z-[110] flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn("border rounded-lg px-4 py-3 text-sm shadow-lg max-w-xs", toastTone[t.tone])}
            style={{ animation: "ui-pop .16s ease-out" }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
