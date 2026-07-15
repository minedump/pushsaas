import { notFound } from "next/navigation";
import { IconDownload } from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { Badge, ButtonLink, Card } from "@/app/ui";
import { buildManifestJson, buildHeadSnippet, type ManifestConfig } from "@/lib/manifest";
import CodeBlock from "./CodeBlock";
import ManifestSetup from "./ManifestSetup";
import ProjectSettings from "./ProjectSettings";
import SetupStep from "./SetupStep";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, domain, is_active, remaining_pushes, tariff_pushes_remaining, package_pushes_remaining, vapid_public_key")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { count } = await supabase
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id)
    .eq("is_active", true);

  const app = process.env.NEXT_PUBLIC_APP_URL || "";
  const snippet = `<script src="${app}/embed/${project.id}.js" async></script>`;
  const swUrl = `${app}/sdk/service-worker.js`;

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
    <main className="max-w-3xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold m-0">{project.name}</h1>
        <Badge tone={project.is_active ? "good" : "bad"} dot>
          {project.is_active ? "активен" : "заблокирован"}
        </Badge>
      </div>
      <p className="text-ink-faint mt-1">{project.domain || "домен не указан"}</p>

      <div className="flex gap-3 mt-5">
        <Card className="flex-1">
          <div className="text-ink-muted text-xs">Подписчиков</div>
          <div className="text-[26px] font-bold">{count ?? 0}</div>
        </Card>
        <Card className="flex-1">
          <div className="text-ink-muted text-xs">Осталось пушей</div>
          <div className="text-[26px] font-bold">{project.remaining_pushes}</div>
          <div className="text-[11px] text-ink-faint">
            тариф {project.tariff_pushes_remaining} · пакет {project.package_pushes_remaining}
          </div>
        </Card>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Подключение сайта</h2>
        <p className="text-ink-muted text-sm">
          Три шага. Уведомления работают на Android и на iPhone (iOS 16.4+, сайт добавлен на экран «Домой»).
        </p>

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
            <code className="font-mono text-[13px] text-accent">data-pushsaas=&quot;manual&quot;</code> и вызывайте{" "}
            <code className="font-mono text-[13px] text-accent">PushSaaS.subscribe()</code>.
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

      <ProjectSettings projectId={project.id} initialName={project.name} initialDomain={project.domain || ""} />
    </main>
  );
}
