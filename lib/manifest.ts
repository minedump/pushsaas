import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";

// Генерация PWA-иконок из одного загруженного логотипа + сборка webmanifest.
// Правила форматов:
//   · icon-192/512 (purpose any, Android/установка) — со скруглением углов ~18%
//   · maskable-192/512 — БЕЗ скругления, логотип 80% на подложке цвета темы
//     (форму — круг/сквиркл — накладывает сама ОС Android)
//   · apple-touch-icon 180×180 — БЕЗ скругления и БЕЗ прозрачности
//     (iOS скругляет сам; прозрачность заливается цветом темы)

export type ManifestConfig = {
  name: string;
  short_name: string;
  theme_color: string;
  icons: { i192: string; i512: string; m192: string; m512: string; apple: string };
  generated_at: string;
};

const BUCKET = "project-assets";

function roundedMask(size: number): Buffer {
  const r = Math.round(size * 0.18);
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
}

async function makeIcons(source: Buffer, themeColor: string) {
  // исходник приводим к квадрату 512 (cover — обрежет лишнее по меньшей стороне)
  const base = await sharp(source).resize(512, 512, { fit: "cover" }).png().toBuffer();

  async function anyIcon(size: number): Promise<Buffer> {
    const img = await sharp(base).resize(size, size).png().toBuffer();
    return sharp(img)
      .composite([{ input: roundedMask(size), blend: "dest-in" }])
      .png()
      .toBuffer();
  }

  async function maskable(size: number): Promise<Buffer> {
    const inner = Math.round(size * 0.8); // безопасная зона maskable
    const logo = await sharp(base).resize(inner, inner).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: themeColor } })
      .composite([{ input: logo, gravity: "centre" }])
      .png()
      .toBuffer();
  }

  async function apple(): Promise<Buffer> {
    return sharp(base).resize(180, 180).flatten({ background: themeColor }).png().toBuffer();
  }

  return {
    "icon-192.png": await anyIcon(192),
    "icon-512.png": await anyIcon(512),
    "icon-maskable-192.png": await maskable(192),
    "icon-maskable-512.png": await maskable(512),
    "apple-touch-icon.png": await apple(),
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
      contentType: "image/png",
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
  return [
    `<link rel="manifest" href="/site.webmanifest">`,
    `<meta name="theme-color" content="${config.theme_color}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${config.icons.apple}">`,
  ].join("\n");
}
