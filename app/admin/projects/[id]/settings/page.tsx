import { notFound } from "next/navigation";
import { IconDownload } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { buildManifestJson, buildHeadSnippet, type ManifestConfig } from "@/lib/manifest";
import { ensureAttributionToken } from "@/lib/attribution";
import { ButtonLink } from "@/app/ui";
import CodeBlock from "../CodeBlock";
import ManifestSetup from "../ManifestSetup";
import SetupStep from "../SetupStep";
import ProjectSettings from "../ProjectSettings";
import AttributionSettings from "./AttributionSettings";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain, is_active, ym_counter_id, timezone, product_feed_url, product_feed_updated_at, product_feed_item_count, product_feed_error")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const app = process.env.NEXT_PUBLIC_APP_URL || "";
  const snippet = `<script src="${app}/embed/${project.id}.js" async></script>`;
  const swUrl = `${app}/sdk/service-worker.js`;

  // Токен вебхука атрибуции — генерируется при первом обращении (best-effort:
  // до миграции 0073 колонки нет, страница не должна падать).
  let attributionToken = "";
  try {
    attributionToken = await ensureAttributionToken(project.id);
  } catch {
    /* колонка ещё не мигрирована — раздел ниже просто не покажет токен */
  }
  const { data: attrRow } = await supabase
    .from("projects")
    .select("attribution_cookie_name, attribution_window_days")
    .eq("id", id)
    .maybeSingle();
  const attribution = {
    cookieName: attrRow?.attribution_cookie_name || "pss_attr",
    windowDays: attrRow?.attribution_window_days || 7,
  };

  // отдельные best-effort запросы: до миграций 0005/0006 колонок нет —
  // страница не падает, просто пустые форма и статусы
  let manifestInitial: { manifest: string; headSnippet: string; icons: ManifestConfig["icons"] } | null = null;
  let setupChecks: Record<string, { ok?: boolean }> = {};
  {
    const { data: mrow, error: merr } = await supabase
      .from("projects")
      .select("manifest_config")
      .eq("id", id)
      .maybeSingle();
    const cfg = !merr ? (mrow?.manifest_config as ManifestConfig | null) : null;
    if (cfg?.icons) {
      manifestInitial = { manifest: buildManifestJson(cfg), headSnippet: buildHeadSnippet(cfg), icons: cfg.icons };
    }
    const { data: crow, error: cerr } = await supabase
      .from("projects")
      .select("setup_checks")
      .eq("id", id)
      .maybeSingle();
    if (!cerr && crow?.setup_checks) setupChecks = crow.setup_checks as Record<string, { ok?: boolean }>;
  }

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold m-0">Настройки</h1>

      <section className="mt-5">
        <h2 className="text-lg font-semibold">Подключение</h2>

        <SetupStep
          projectId={project.id}
          step="sw"
          title="Шаг 1 — скачайте и загрузите скрипт в раздел «Файлы»"
          initialOk={!!setupChecks.sw?.ok}
        >
          <ButtonLink href={swUrl} download variant="secondary" size="sm">
            <IconDownload size={15} stroke={1.8} />
            Скачать service-worker.js
          </ButtonLink>
          <p className="text-[13px] text-ink-faint mt-2 mb-0">
            Загрузите скачанный файл в раздел{" "}
            {project.domain ? (
              <a href={`https://${project.domain}/admin2/account_files`} target="_blank" rel="noreferrer" className="text-accent">
                Файлы
              </a>
            ) : (
              "«Файлы»"
            )}{" "}
            — оттуда он будет доступен в корне сайта.
          </p>
        </SetupStep>

        <SetupStep
          projectId={project.id}
          step="snippet"
          title="Шаг 2 — вставьте код в раздел <body>"
          initialOk={!!setupChecks.snippet?.ok}
        >
          <CodeBlock code={snippet} />
          <p className="text-[13px] text-ink-faint">
            {project.domain ? (
              <a
                href={`https://${project.domain}/admin2/account/codes_settings`}
                target="_blank"
                rel="noreferrer"
                className="text-accent"
              >
                Настройки → Блоки кода
              </a>
            ) : (
              "Настройки → Блоки кода"
            )}{" "}
            → «В раздел &lt;body&gt;» → вставьте код и сохраните.
          </p>
          <p className="text-[13px] text-ink-faint mb-0">
            Появится кнопка «🔔 Уведомления». Чтобы вызывать подписку своей кнопкой, добавьте элемент с{" "}
            <code className="font-mono text-[13px] text-accent">data-sendera=&quot;manual&quot;</code> и вызывайте{" "}
            <code className="font-mono text-[13px] text-accent">sendera.subscribe()</code>.
          </p>
        </SetupStep>

        <SetupStep
          projectId={project.id}
          step="manifest"
          title="Шаг 3 — добавьте PWA-манифест на сайт"
          initialOk={!!setupChecks.manifest?.ok}
        >
          <p className="text-sm text-ink-muted mt-0">
            Чтобы сайт устанавливался на экран «Домой» как приложение, нужен файл{" "}
            <code className="font-mono text-[13px] text-accent">site.webmanifest</code> и пара строк в{" "}
            <code className="font-mono text-[13px] text-accent">&lt;head&gt;</code>. Заполните форму — иконки всех
            форматов и готовый файл сделаем сами.
          </p>
          <ManifestSetup projectId={project.id} initial={manifestInitial} domain={project.domain} />
        </SetupStep>
      </section>

      <ProjectSettings
        projectId={project.id}
        initialName={project.name}
        initialYmCounterId={project.ym_counter_id}
        initialTimezone={project.timezone || "Europe/Moscow"}
        initialFeedUrl={project.product_feed_url}
        feedUpdatedAt={project.product_feed_updated_at}
        feedItemCount={project.product_feed_item_count || 0}
        feedError={project.product_feed_error}
      />

      {attributionToken && (
        <AttributionSettings
          projectId={project.id}
          domain={project.domain}
          webhookUrl={`${app}/api/v1/attribute?key=${attributionToken}`}
          initial={attribution}
        />
      )}
    </main>
  );
}
