"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "./Input";

// Полностью свой пикер цвета — без <input type="color">, чей вид (нативный
// системный диалог ОС) нельзя ни стилизовать, ни держать внутри поповера
// вместе с пресетами: он рисуется браузером поверх всего и перехватывает
// клик целиком. SV-квадрат + полоса оттенка — тот же принцип, что у любого
// стандартного color-picker'а (HSV), плюс пресеты-кружки.

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g - b) / d) % 6) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

// Общий хелпер перетаскивания и клика по прямоугольной области — и SV-квадрат,
// и полоса оттенка используют его, отличается только то, что делают с
// нормализованными [0..1] координатами.
function useDragArea(onMove: (nx: number, ny: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  function report(clientX: number, clientY: number) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = clamp01((clientX - rect.left) / rect.width);
    const ny = clamp01((clientY - rect.top) / rect.height);
    onMove(nx, ny);
  }

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (!draggingRef.current) return;
      report(e.clientX, e.clientY);
    }
    function onPointerUp() {
      draggingRef.current = false;
    }
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    report(e.clientX, e.clientY);
  }

  return { ref, onPointerDown };
}

function CustomColorPicker({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) {
  const parsed = hexToHsv(hex) || { h: 210, s: 0.6, v: 0.4 };
  const [h, setH] = useState(parsed.h);
  const [s, setS] = useState(parsed.s);
  const [v, setV] = useState(parsed.v);

  // Внешний hex мог поменяться не через сам пикер (пресет, ручной ввод в
  // текстовое поле) — пересчитываем h/s/v, но не наоборот: свой hsv не
  // перезаписываем на каждый рендер, иначе перетаскивание дёргалось бы.
  useEffect(() => {
    const next = hexToHsv(hex);
    if (!next) return;
    setH(next.h);
    setS(next.s);
    setV(next.v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  const sv = useDragArea((nx, ny) => {
    const ns = nx;
    const nv = 1 - ny;
    setS(ns);
    setV(nv);
    onChange(hsvToHex(h, ns, nv));
  });
  const hue = useDragArea((nx) => {
    const nh = nx * 360;
    setH(nh);
    onChange(hsvToHex(nh, s, v));
  });

  const pureHue = hsvToHex(h, 1, 1);

  return (
    <div className="flex flex-col gap-2.5 w-[200px]">
      <div
        ref={sv.ref}
        onPointerDown={sv.onPointerDown}
        className="relative w-full h-[130px] rounded-md cursor-crosshair touch-none"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})`,
        }}
      >
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex, boxShadow: "0 0 0 1px rgba(0,0,0,.35)" }}
        />
      </div>
      <div
        ref={hue.ref}
        onPointerDown={hue.onPointerDown}
        className="relative w-full h-3 rounded-full cursor-pointer touch-none"
        style={{ background: "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)" }}
      >
        <div
          className="absolute top-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${(h / 360) * 100}%`, background: pureHue, boxShadow: "0 0 0 1px rgba(0,0,0,.35)" }}
        />
      </div>
    </div>
  );
}

export function ColorField({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "#2c4a66";

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-9 h-9 shrink-0 rounded-lg border border-border shadow-inner cursor-pointer"
          style={{ backgroundColor: normalized }}
          aria-label="Выбрать цвет"
          title="Выбрать цвет"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#2c4a66" className="font-mono" />
      </div>
      {open && (
        // z-index выше WIDGET_Z_INDEX (999999) — превью виджета на этой же
        // странице рисует свою плавающую кнопку/плашку с этим z-index, попап
        // пикера должен оставаться поверх него, а не наоборот.
        <div className="absolute z-[1000000] top-full left-0 mt-1.5 flex flex-col gap-3 bg-surface border border-border rounded-lg shadow-lg p-3 w-max">
          <CustomColorPicker hex={normalized} onChange={onChange} />
          {presets && presets.length > 0 && (
            <div className="flex gap-1.5 items-center flex-nowrap">
              {presets.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className={`w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110 ${
                    normalized === c.toLowerCase() ? "ring-2 ring-accent ring-offset-1" : "border border-border"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Цвет ${c}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
