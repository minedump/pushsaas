"use client";

import { Textarea, Toggle } from "@/app/ui";

// Ручной JSON-контекст для Liquid — скрыт под тумблером, чтобы не мозолить
// глаза в обычном сценарии (без персонализации). Используется в формах
// рассылок и шаблонов после выбора шаблона/канала — подставляется в Liquid
// точно так же, как атрибуты подписчика при реальной отправке.
export function ContextField({
  enabled,
  onToggle,
  value,
  onChange,
  error,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div>
      <Toggle checked={enabled} onChange={onToggle} label="Добавить контекст" />
      {enabled && (
        <>
          <div className="h-2" />
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className="font-mono text-xs"
            placeholder='{"name": "Иван", "percent": 20}'
          />
          {error && <p className="text-[11px] text-bad mt-1 mb-0">{error}</p>}
        </>
      )}
    </div>
  );
}
