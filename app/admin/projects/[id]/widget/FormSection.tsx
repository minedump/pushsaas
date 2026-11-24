import type { ReactNode } from "react";
import { Label } from "@/app/ui";

// Общие кирпичики форм виджетов — чтобы все вкладки «Виджетов» выглядели одинаково:
// раздел с линией сверху и заголовком (как «Когда показывать») и поле с подписью.
// Порядок разделов в каждой форме: тексты → «Оформление» → правила показа → «Сохранить» →
// «Предпросмотр на сайте». В «Оформлении»: угол экрана и размер → цвета парами → скругление.

export function FormSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pt-3 border-t border-border">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-ink-faint mt-0.5 mb-0">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-ink-faint mt-1 mb-0">{hint}</p>}
    </div>
  );
}

// две колонки на компьютере, одна на телефоне — для пар «цвет / цвет текста», «угол / размер»
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}
