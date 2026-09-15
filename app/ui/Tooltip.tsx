"use client";

import { useEffect } from "react";

// Подсказки по атрибуту — как MarketHelp: у элемента просто data-tip="текст"
// (+ необязательный data-tip-pos="top|bottom|left|right" — предпочитаемая
// сторона), без обёртки-компонента на каждое место использования. Один
// пузырь на всю страницу создаётся здесь один раз (TooltipHost монтируется
// в AdminShell рядом с DialogProvider) и переиспользуется — не по элементу.
// Вид и геометрия стрелки — в globals.css (.tooltip-bubble[data-side=...]),
// здесь только позиционирование.
//
// «Умная» часть — сторона выбирается сама: если у предпочитаемой стороны не
// хватает места до края экрана, пробуем остальные по порядку и остаёмся на
// первой, которая помещается; вдоль своей стороны пузырь прижимается к
// краю, а стрелка продолжает целиться в центр элемента, а не в центр пузыря.
// Позиционирование — прямые DOM-чтения/записи в эффекте, а не через React
// state: значение бы отставало на кадр (сначала отрисовать текст, потом
// измерить), здесь без этого кадра-задержки.
const GAP = 10;
const PAD = 8;
const DELAY = 120;

type Side = "top" | "bottom" | "left" | "right";
const ORDERS: Record<Side, Side[]> = {
  top: ["top", "bottom", "right", "left"],
  bottom: ["bottom", "top", "right", "left"],
  left: ["left", "right", "top", "bottom"],
  right: ["right", "left", "top", "bottom"],
};

export function TooltipHost() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.className = "tooltip-bubble";
    tip.setAttribute("role", "tooltip");
    const text = document.createElement("span");
    const arrow = document.createElement("i");
    arrow.className = "tooltip-arrow";
    tip.append(text, arrow);

    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function place(t: HTMLElement) {
      const r = t.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const want = (t.getAttribute("data-tip-pos") as Side) || "top";

      const fits: Record<Side, boolean> = {
        top: r.top >= h + GAP + PAD,
        bottom: vh - r.bottom >= h + GAP + PAD,
        left: r.left >= w + GAP + PAD,
        right: vw - r.right >= w + GAP + PAD,
      };
      const order = ORDERS[want] || ORDERS.top;
      let side: Side = order[0];
      for (const s of order) {
        if (fits[s]) {
          side = s;
          break;
        }
      }

      let x: number, y: number;
      if (side === "top" || side === "bottom") {
        x = r.left + r.width / 2 - w / 2;
        y = side === "top" ? r.top - h - GAP : r.bottom + GAP;
      } else {
        y = r.top + r.height / 2 - h / 2;
        x = side === "left" ? r.left - w - GAP : r.right + GAP;
      }
      x = Math.min(Math.max(x, PAD), Math.max(PAD, vw - w - PAD));
      y = Math.min(Math.max(y, PAD), Math.max(PAD, vh - h - PAD));

      tip.dataset.side = side;
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

      if (side === "top" || side === "bottom") {
        arrow.style.top = "";
        arrow.style.left = `${Math.round(Math.min(Math.max(r.left + r.width / 2 - x, 12), w - 12))}px`;
      } else {
        arrow.style.left = "";
        arrow.style.top = `${Math.round(Math.min(Math.max(r.top + r.height / 2 - y, 12), h - 12))}px`;
      }
    }

    function show(t: HTMLElement) {
      if (tip.parentNode !== document.body) document.body.appendChild(tip);
      text.textContent = t.getAttribute("data-tip");
      place(t);
      tip.dataset.show = "1";
      current = t;
      t.setAttribute("aria-describedby", "app-tip");
    }

    function hide() {
      if (timer) clearTimeout(timer);
      if (!current) return;
      tip.dataset.show = "0";
      current.removeAttribute("aria-describedby");
      current = null;
    }

    function trigger(e: Event): HTMLElement | null {
      const target = e.target as HTMLElement | null;
      return (target?.closest?.("[data-tip]") as HTMLElement | null) ?? null;
    }

    function onMouseOver(e: MouseEvent) {
      const t = trigger(e);
      if (!t || t === current) return;
      if (timer) clearTimeout(timer);
      if (current) show(t);
      else timer = setTimeout(() => show(t), DELAY);
    }
    function onMouseOut(e: MouseEvent) {
      const t = trigger(e);
      if (!t) return;
      if (e.relatedTarget && t.contains(e.relatedTarget as Node)) return;
      hide();
    }
    function onFocusIn(e: FocusEvent) {
      const t = trigger(e);
      if (timer) clearTimeout(timer);
      if (t) {
        if (t !== current) show(t);
      } else hide();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }
    function onScrollOrResize() {
      if (current) place(current);
    }

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      if (timer) clearTimeout(timer);
      tip.remove();
    };
  }, []);

  return null;
}
