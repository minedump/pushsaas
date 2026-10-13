import { SCENE_TEMPLATES } from "./templates";

// Сборка схемы шага «Установки приложения»: берём шаблон (SVG по макету
// заказчика) и подставляем данные проекта — адрес сайта, короткое название,
// иконку (или букву на плашке цвета темы, если манифест ещё не сгенерирован).
// Результат — самодостаточный SVG без внешних ссылок: иконка вшита как data-URI,
// потому что SVG, показанный через <img>, не умеет подгружать внешние ресурсы.

export type SceneContext = {
  short: string; // подпись под иконкой и название в поле «Создать ярлык»
  domain: string; // адрес сайта в строке браузера
  color: string; // цвет темы (плашка с буквой, если нет иконки)
  icon: string | null; // data:image/png;base64,... — apple-touch-icon проекта
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Ширины символов Helvetica/Arial в тысячных em: близки к SF Pro, Roboto и
// системным шрифтам. Текст ставится с жёстко заданной длиной (textLength), поэтому
// пара «замок + адрес» и каретка в поле позиционируются точно, без измерения шрифта.
const CW: Record<string, number> = {
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, ".": 278, "-": 333,
};
const CWU: Record<string, number> = {
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, " ": 278,
};
function textW(s: string, size: number): number {
  let w = 0;
  for (const c of s) w += CWU[c] ?? CW[c] ?? CW[c.toLowerCase()] ?? (c >= "0" && c <= "9" ? 556 : 600);
  return (w * size) / 1000;
}

// ---------- iPhone ----------
type Bar = { cover: [number, number, number, number]; size: number; maxw: number; lock: [number, number]; gap: number; lockY: number; base: number };
// У каждого макета своя адресная строка: закрываем старый адрес плашкой того же цвета и рисуем новый.
const BAR_A: Bar = { cover: [140, 798, 245, 56], size: 25, maxw: 190, lock: [15, 12], gap: 9, lockY: 823.5, base: 832 };
const BAR_B: Bar = { cover: [135, 816, 250, 40], size: 17, maxw: 200, lock: [10, 8], gap: 6, lockY: 834.5, base: 841 };
const IOS_FONT = "-apple-system,&apos;SF Pro Text&apos;,&apos;Segoe UI&apos;,Roboto,Helvetica,Arial,sans-serif";

function addressBar(tpl: string, bar: Bar, domain: string): string {
  let size = bar.size;
  let fw = textW(domain, size);
  if (fw > bar.maxw) {
    size = (size * bar.maxw) / fw;
    fw = bar.maxw;
  }
  const [lw, lh] = bar.lock;
  const x0 = 257.5 - (lw + bar.gap + fw) / 2;
  const tx = x0 + lw + bar.gap;
  const c = bar.cover;
  const o =
    `<rect x="${c[0]}" y="${c[1]}" width="${c[2]}" height="${c[3]}" fill="#6D6D6D"/>` +
    `<rect x="${x0.toFixed(1)}" y="${bar.lockY}" width="${lw}" height="${lh}" rx="${(lw * 0.17).toFixed(1)}" fill="#BDBDBD"/>` +
    `<path d="M${(x0 + lw * 0.23).toFixed(1)} ${bar.lockY}v-${(lh * 0.3).toFixed(1)}a${(lw * 0.27).toFixed(1)} ${(lw * 0.27).toFixed(1)} 0 01${(lw * 0.54).toFixed(1)} 0V${bar.lockY}" stroke="#BDBDBD" stroke-width="${(lw * 0.13).toFixed(1)}" fill="none"/>` +
    `<text x="${tx.toFixed(1)}" y="${bar.base}" font-size="${size.toFixed(1)}" textLength="${fw.toFixed(1)}" lengthAdjust="spacingAndGlyphs" fill="#ffffff" font-family="${IOS_FONT}">${esc(domain)}</text>`;
  return tpl.replace("</svg>", o + "</svg>");
}

// Плитка иконки на домашнем экране iPhone (скруглённый квадрат 130×130 из макета).
const HOME_TILE =
  "M293.612 241H221.032C204.998 241 192 253.998 192 270.032V342.612C192 358.646 204.998 371.644 221.032 371.644H293.612C309.646 371.644 322.644 358.646 322.644 342.612V270.032C322.644 253.998 309.646 241 293.612 241Z";

let uid = 0;
// Иконка проекта в заданной форме: вшитая картинка под маской или, если иконки
// нет, плашка цвета темы с первой буквой названия.
function tile(ctx: SceneContext, cx: number, cy: number, d: number, kind: "circle" | "rrect", letter: string, fontFamily: string, pathD?: string): string {
  const x = cx - d / 2;
  const y = cy - d / 2;
  const shape = (extra: string) =>
    pathD
      ? `<path d="${pathD}" ${extra}/>`
      : kind === "circle"
        ? `<circle cx="${cx}" cy="${cy}" r="${d / 2}" ${extra}/>`
        : `<rect x="${x}" y="${y}" width="${d}" height="${d}" rx="${(d * 0.22).toFixed(1)}" ${extra}/>`;
  if (ctx.icon) {
    const id = `pss-ic-${++uid}`;
    return (
      `<clipPath id="${id}">${shape("")}</clipPath>` +
      `<image x="${x}" y="${y}" width="${d}" height="${d}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" href="${ctx.icon}" xlink:href="${ctx.icon}"/>`
    );
  }
  const fs = d * 0.55;
  return (
    shape(`fill="${ctx.color}"`) +
    `<text x="${cx}" y="${(cy + fs * 0.36).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="600" text-anchor="middle" fill="#ffffff" font-family="${fontFamily}">${esc(letter)}</text>`
  );
}

function iosHome(tpl: string, ctx: SceneContext): string {
  let size = 26;
  let fw = textW(ctx.short, size);
  if (fw > 200) {
    size = (size * 200) / fw;
    fw = 200;
  }
  const o =
    tile(ctx, 257.3, 306.3, 130.6, "rrect", ctx.short.charAt(0), IOS_FONT, HOME_TILE) +
    `<text x="257.5" y="406" font-size="${size.toFixed(1)}" textLength="${fw.toFixed(1)}" lengthAdjust="spacingAndGlyphs" text-anchor="middle" fill="#ffffff" font-family="${IOS_FONT}">${esc(ctx.short)}</text>`;
  return tpl.replace("<!--APP-->", o);
}

// ---------- Android ----------
const AND_FONT = "Roboto,&apos;Google Sans&apos;,-apple-system,&apos;Segoe UI&apos;,Helvetica,Arial,sans-serif";

function andText(x: number, y: number, size: number, s: string, o: { maxw: number; mid?: boolean; fill?: string }): { w: number; svg: string } {
  let fw = textW(s, size);
  let sz = size;
  if (fw > o.maxw) {
    sz = (size * o.maxw) / fw;
    fw = o.maxw;
  }
  return {
    w: fw,
    svg: `<text x="${x}" y="${y}" font-size="${sz.toFixed(1)}" textLength="${fw.toFixed(1)}" lengthAdjust="spacingAndGlyphs"${o.mid ? ' text-anchor="middle"' : ""} fill="${o.fill || "#000"}" font-family="${AND_FONT}">${esc(s)}</text>`,
  };
}

function androidScene(id: string, tpl: string, ctx: SceneContext): string {
  const L = ctx.short.charAt(0);
  let t = tpl;
  if (id === "and-open") t = t.replace("<!--DOMAIN1-->", andText(71, 211, 20, ctx.domain, { maxw: 380 }).svg);
  if (id === "and-menu-button") t = t.replace("<!--DOMAIN2-->", andText(160, 196, 16, ctx.domain, { maxw: 125, fill: "#1B1B1D" }).svg);
  if (id === "and-shortcut") {
    const nt = andText(162, 370, 21, ctx.short, { maxw: 230 });
    t = t
      .replace("<!--DOMAIN2-->", andText(160, 196, 16, ctx.domain, { maxw: 125, fill: "#1B1B1D" }).svg)
      .replace("<!--ICON4-->", tile(ctx, 125, 364, 32, "circle", L, AND_FONT))
      .replace("<!--NAME4-->", nt.svg + `<rect x="${(162 + nt.w + 2).toFixed(1)}" y="355" width="1.6" height="18" fill="#000"/>`);
  }
  if (id === "and-confirm") {
    t = t
      .replace("<!--ICON5-->", tile(ctx, 256.5, 762.5, 65, "rrect", L, AND_FONT))
      .replace("<!--LABEL5-->", andText(255.5, 818, 14, ctx.short, { maxw: 160, mid: true }).svg);
  }
  if (id === "and-home") {
    t = t
      .replace("<!--ICON6-->", tile(ctx, 258, 322, 128, "circle", L, AND_FONT))
      .replace("<!--LABEL6-->", andText(258, 413, 20, ctx.short, { maxw: 200, mid: true }).svg);
  }
  return t;
}

// null — если такой схемы нет.
export function renderInstallScene(id: string, ctx: SceneContext): string | null {
  const tpl = SCENE_TEMPLATES[id];
  if (!tpl) return null;
  if (id === "ios-open") return addressBar(tpl, BAR_A, ctx.domain);
  if (id === "ios-share") return addressBar(tpl, BAR_B, ctx.domain);
  if (id === "ios-home") return iosHome(tpl, ctx);
  if (id.startsWith("and-")) return androidScene(id, tpl, ctx);
  return tpl; // ios-sheet — без подстановок (меню Safari)
}
