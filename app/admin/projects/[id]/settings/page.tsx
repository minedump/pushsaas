import { notFound } from "next/navigation";
import { IconDownload } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { buildManifestJson, buildHeadSnippet, type ManifestConfig } from "@/lib/manifest";
import { ensureAttributionToken } from "@/lib/attribution";
import { ButtonLink } from "@/app/ui";
import CodeBlock from "../CodeBlock";
import ManifestSetup from "../ManifestSetup";
import SetupStep, { type SavedCheck } from "../SetupStep";
import ProjectSettings from "../ProjectSettings";
import AttributionSettings from "./AttributionSettings";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, domain, is_active, owner_id, ym_counter_id, timezone, product_feed_url, product_feed_updated_at, product_feed_item_count, product_feed_error, logo_url"
    )
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // Удалить проект может владелец и администратор платформы; Админу проекта
  // кнопка не показывается (роут удаления проверяет то же самое).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const canDelete = !!user && (project.owner_id === user.id || myProfile?.role === "admin");

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
    .select("attribution_cookie_name, attribution_window_days, client_sms_field, client_field_map, order_field_map")
    .eq("id", id)
    .maybeSingle();
  const attribution = {
    cookieName: attrRow?.attribution_cookie_name || "pss_attr",
    windowDays: attrRow?.attribution_window_days || 7,
  };

  // Доп. поля контактов, которые уже есть у проекта: из них выбираем, куда сохранять поля клиента магазина.
  const { data: attrOwners } = await supabase.from("identities").select("attributes").eq("project_id", id).limit(5000);
  const knownAttrKeys = [...new Set((attrOwners ?? []).flatMap((i) => Object.keys((i.attributes as object) || {})))].sort((a, b) => a.localeCompare(b, "ru"));

  // Подсказки для соответствия полей: поля магазина, которые уже приходили в вебхуках клиента и заказа
  // (handle и название из последних вызовов), и доп. поля уже сохранённых заказов.
  const { data: recentCalls } = await supabase
    .from("api_call_log")
    .select("request_body")
    .eq("project_id", id)
    .in("endpoint", ["contacts", "attribute"])
    .order("created_at", { ascending: false })
    .limit(300);
  const storeFieldNames = new Map<string, string>();
  for (const call of recentCalls ?? []) {
    const body = ((call as { request_body?: unknown }).request_body ?? {}) as { fields_values?: unknown; client?: { fields_values?: unknown } };
    for (const list of [body.fields_values, body.client?.fields_values]) {
      if (!Array.isArray(list)) continue;
      for (const f of list as { handle?: unknown; name?: unknown }[]) {
        const handle = typeof f?.handle === "string" ? f.handle.trim() : "";
        if (handle && !storeFieldNames.has(handle)) storeFieldNames.set(handle, typeof f?.name === "string" ? f.name.trim() : "");
      }
    }
  }
  const storeFields = [...storeFieldNames.entries()].map(([handle, name]) => ({ handle, name })).sort((a, b) => a.handle.localeCompare(b.handle, "ru"));
  const { data: orderAttrOwners } = await supabase.from("order_attributions").select("attributes").eq("project_id", id).order("created_at", { ascending: false }).limit(2000);
  const knownOrderKeys = [...new Set((orderAttrOwners ?? []).flatMap((o) => Object.keys((o.attributes as object) || {})))].sort((a, b) => a.localeCompare(b, "ru"));

  // отдельные best-effort запросы: до миграций 0005/0006 колонок нет —
  // страница не падает, просто пустые форма и статусы
  let manifestInitial: { manifest: string; headSnippet: string; icons: ManifestConfig["icons"] } | null = null;
  let setupChecks: Record<string, SavedCheck> = {};
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
    if (cerr) console.error("[settings] read setup_checks failed:", cerr.message);
    else if (crow?.setup_checks) setupChecks = crow.setup_checks as Record<string, SavedCheck>;
  }

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold m-0">Настройки</h1>

      <section className="mt-4 sm:mt-8">
        <h2 className="text-lg font-semibold">Подключение</h2>

        <SetupStep
          projectId={project.id}
          step="sw"
          title="Шаг 1 — скачайте и загрузите скрипт в раздел «Файлы»"
          initial={setupChecks.sw}
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
          initial={setupChecks.snippet}
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
            Появится кнопка «🔔 Уведомления» (настраивается в разделе{" "}
            <a href={`/admin/projects/${project.id}/widget`} className="text-accent">
              «Виджеты»
            </a>
            ). Чтобы вызывать подписку своей кнопкой — выключите её там и вызывайте{" "}
            <code className="font-mono text-[13px] text-accent">sendera.subscribe()</code> сами (полный список методов — тоже в «Виджеты»).
          </p>
        </SetupStep>

        <SetupStep
          projectId={project.id}
          step="manifest"
          title="Шаг 3 — добавьте PWA-манифест на сайт"
          initial={setupChecks.manifest}
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
        domain={project.domain}
        initialYmCounterId={project.ym_counter_id}
        initialTimezone={project.timezone || "Europe/Moscow"}
        initialFeedUrl={project.product_feed_url}
        feedUpdatedAt={project.product_feed_updated_at}
        feedItemCount={project.product_feed_item_count || 0}
        feedError={project.product_feed_error}
        initialLogoUrl={project.logo_url}
        canDelete={canDelete}
      />

      {attributionToken && (
        <AttributionSettings
          projectId={project.id}
          domain={project.domain}
          webhookUrl={`${app}/api/v1/attribute?key=${attributionToken}`}
          clientWebhookUrl={`${app}/api/v1/client?key=${attributionToken}`}
          initialSmsField={(attrRow as { client_sms_field?: string | null } | null)?.client_sms_field || ""}
          initialFieldMap={Array.isArray((attrRow as { client_field_map?: unknown } | null)?.client_field_map) ? ((attrRow as { client_field_map: { handle: string; key: string }[] }).client_field_map) : []}
          initialOrderFieldMap={Array.isArray((attrRow as { order_field_map?: unknown } | null)?.order_field_map) ? ((attrRow as { order_field_map: { handle: string; key: string }[] }).order_field_map) : []}
          knownKeys={knownAttrKeys}
          knownOrderKeys={knownOrderKeys}
          storeFields={storeFields}
          initial={attribution}
        />
      )}
    </main>
  );
}
