import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";

// Генерация PWA-иконок из одного загруженного логотипа + сборка webmanifest.
// Правила форматов:
//   · icon-192/512 (purpose any, Android/установка) — со скруглением углов ~18%
//   · maskable-192/512 — БЕЗ скругления, логотип 80% на подложке цвета темы
//     (форму — круг/сквиркл — накладывает сама ОС Android)
//   · apple-touch-icon 180×180 — БЕЗ скругления и БЕЗ прозрачности
//     (iOS скругляет сам; прозрачность заливается цветом темы)
//   · favicon-96x96.png и favicon.ico (16/32/48) — как "any", со скруглением. SVG-фавикон
//     из растра не делаем: честного вектора из картинки не получить.

export type ManifestConfig = {
  name: string;
  short_name: string;
  theme_color: string;
  icons: {
    i192: string;
    i512: string;
    m192: string;
    m512: string;
    apple: string;
    // фавиконы добавлены позже: у проектов, сгенерированных раньше, их нет до перегенерации
    f96?: string;
    ico?: string;
  };
  generated_at: string;
};

const BUCKET = "project-assets";

// Финальные PNG жмём в 8-битную палитру (libimagequant). На текстурном логотипе 512×512
// это 562 КБ → ~200 КБ при разнице на глаз не видной (макс. отклонение ~20 из 255),
// а чистый lossless даёт лишь -13%. Промежуточные буферы остаются обычными PNG.
const PNG_OUT = { palette: true, quality: 85, effort: 10, compressionLevel: 9 } as const;

function roundedMask(size: number): Buffer {
  const r = Math.round(size * 0.18);
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
}

// ICO-контейнер из PNG-картинок (PNG внутри ICO поддерживают все браузеры с Vista/IE9).
function buildIco(images: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = head.length + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o); // width
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1); // height
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bit count
    dir.writeUInt32LE(img.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });
  return Buffer.concat([head, dir, ...images.map((i) => i.data)]);
}

async function makeIcons(source: Buffer, themeColor: string) {
  // исходник приводим к квадрату 512 (cover — обрежет лишнее по меньшей стороне)
  const base = await sharp(source).resize(512, 512, { fit: "cover" }).png().toBuffer();

  async function anyIcon(size: number): Promise<Buffer> {
    const img = await sharp(base).resize(size, size).png().toBuffer();
    return sharp(img)
      .composite([{ input: roundedMask(size), blend: "dest-in" }])
      .png(PNG_OUT)
      .toBuffer();
  }

  async function maskable(size: number): Promise<Buffer> {
    const inner = Math.round(size * 0.8); // безопасная зона maskable
    const logo = await sharp(base).resize(inner, inner).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: themeColor } })
      .composite([{ input: logo, gravity: "centre" }])
      .png(PNG_OUT)
      .toBuffer();
  }

  async function apple(): Promise<Buffer> {
    return sharp(base).resize(180, 180).flatten({ background: themeColor }).png(PNG_OUT).toBuffer();
  }

  // фавикон: те же скруглённые "any"; мелкие размеры без палитры (там и так единицы КБ)
  async function faviconPng(size: number): Promise<Buffer> {
    const img = await sharp(base).resize(size, size).png().toBuffer();
    return sharp(img)
      .composite([{ input: roundedMask(size), blend: "dest-in" }])
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  const ico = buildIco(
    await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await faviconPng(size) })))
  );

  return {
    "icon-192.png": await anyIcon(192),
    "icon-512.png": await anyIcon(512),
    "icon-maskable-192.png": await maskable(192),
    "icon-maskable-512.png": await maskable(512),
    "apple-touch-icon.png": await apple(),
    "favicon-96x96.png": await anyIcon(96),
    "favicon.ico": ico,
  };
}

async function ensureBucket() {
  const admin = createAdminClient();
  // createBucket падает, если уже существует — это норма
  await admin.storage.createBucket(BUCKET, { public: true }).catch(() => {});
}

export async function generateManifestAssets(
  projectId: string,
  iconSource: Buffer,
  fields: { name: string; shortName: string; themeColor: string }
): Promise<ManifestConfig> {
  const admin = createAdminClient();
  await ensureBucket();

  const files = await makeIcons(iconSource, fields.themeColor);
  const urls: Record<string, string> = {};

  for (const [filename, buf] of Object.entries(files)) {
    const path = `${projectId}/${filename}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType: filename.endsWith(".ico") ? "image/x-icon" : "image/png",
      cacheControl: "86400",
      upsert: true,
    });
    if (error) throw new Error(`upload ${filename}: ${error.message}`);
    urls[filename] = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const config: ManifestConfig = {
    name: fields.name,
    short_name: fields.shortName,
    theme_color: fields.themeColor,
    icons: {
      i192: urls["icon-192.png"],
      i512: urls["icon-512.png"],
      m192: urls["icon-maskable-192.png"],
      m512: urls["icon-maskable-512.png"],
      apple: urls["apple-touch-icon.png"],
      f96: urls["favicon-96x96.png"],
      ico: urls["favicon.ico"],
    },
    generated_at: new Date().toISOString(),
  };

  await admin.from("projects").update({ manifest_config: config }).eq("id", projectId);
  return config;
}

// Содержимое site.webmanifest. display:standalone ОБЯЗАТЕЛЕН для пушей на iOS.
export function buildManifestJson(config: ManifestConfig): string {
  return JSON.stringify(
    {
      name: config.name,
      short_name: config.short_name,
      // Стабильный идентификатор приложения: без id Chrome берёт start_url и ругается
      // в DevTools. "/" даёт тот же адрес (https://сайт/), что и вычисленный раньше,
      // поэтому уже установленные приложения не превращаются в новые.
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: config.theme_color,
      theme_color: config.theme_color,
      icons: [
        { src: config.icons.i192, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: config.icons.i512, sizes: "512x512", type: "image/png", purpose: "any" },
        { src: config.icons.m192, sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: config.icons.m512, sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2
  );
}

export function buildHeadSnippet(config: ManifestConfig): string {
  const lines = [
    `<link rel="manifest" href="/site.webmanifest">`,
    `<meta name="theme-color" content="${config.theme_color}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${config.icons.apple}">`,
  ];
  // у проектов, сгенерированных до появления фавиконов, этих ссылок нет — строки не выводим
  if (config.icons.ico) lines.push(`<link rel="shortcut icon" href="${config.icons.ico}" type="image/x-icon">`);
  if (config.icons.f96) lines.push(`<link rel="icon" sizes="96x96" href="${config.icons.f96}" type="image/png">`);
  return lines.join("\n");
}
