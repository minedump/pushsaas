import { notFound } from "next/navigation";
import { Fragment } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProjectAccessible } from "@/lib/guards";
import { ButtonLink, Badge, Card } from "@/app/ui";
import { IconDownload } from "@tabler/icons-react";
import { API_GROUPS, type ApiField, type ApiEndpoint } from "@/lib/apiSpec";
import ApiKeys from "./ApiKeys";

// Первый столбец — одна и та же ширина во всех табличках раздела (Поле /
// Заголовок / status / Код), чтобы они выглядели единообразно друг под другом.
const COL1 = "w-40 shrink-0";

function FieldsTable({ fields }: { fields: ApiField[] }) {
  return (
    <div className="overflow-x-auto pretty-scroll mt-2">
      <table className="w-full border-collapse text-[12.5px] table-fixed">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className={`${COL1} pr-3 pb-1.5 font-normal`}>Поле</th>
            <th className="pb-1.5 font-normal">Описание</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <Fragment key={f.name}>
              <tr className="border-t border-border align-top">
                <td className={`${COL1} pr-3 py-1.5 break-all`}>
                  <code className="font-mono">{f.name}</code>
                  {f.required && <span className="text-bad"> *</span>}
                  <div className="font-mono text-ink-faint text-[11px] mt-0.5 break-words">{f.type}</div>
                </td>
                <td className="py-1.5 text-ink-muted">{f.description}</td>
              </tr>
              {f.children?.map((c) => (
                <tr key={`${f.name}.${c.name}`} className="border-t border-border align-top bg-surface-2/50">
                  <td className={`${COL1} pr-3 py-1.5 pl-4 break-all`}>
                    <span className="text-ink-faint">↳ </span>
                    <code className="font-mono">{c.name}</code>
                    {c.required && <span className="text-bad"> *</span>}
                    <div className="font-mono text-ink-faint text-[11px] mt-0.5 break-words">{c.type}</div>
                  </td>
                  <td className="py-1.5 text-ink-muted">{c.description}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="mt-2 group">
      <summary className="text-[12.5px] text-accent cursor-pointer select-none list-none flex items-center gap-1">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>
        {title}
      </summary>
      <div className="mt-1.5 pl-1">{children}</div>
    </details>
  );
}

function HeadersTable({ needsContentType }: { needsContentType: boolean }) {
  return (
    <div className="overflow-x-auto pretty-scroll mt-2">
      <table className="w-full border-collapse text-[12.5px] table-fixed">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className={`${COL1} pr-3 pb-1.5 font-normal`}>Заголовок</th>
            <th className="pb-1.5 font-normal">Значение</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border align-top">
            <td className={`${COL1} pr-3 py-1.5 font-mono`}>Authorization</td>
            <td className="py-1.5 font-mono text-ink-muted">Bearer wpk_ВАШ_КЛЮЧ</td>
          </tr>
          {needsContentType && (
            <tr className="align-top border-t border-border">
              <td className={`${COL1} pr-3 py-1.5 font-mono`}>Content-Type</td>
              <td className="py-1.5 font-mono text-ink-muted">application/json</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Подпись раздела (Метод/Эндпоинт/Query-параметры/Заголовки) — заметно
// отличается от собственных заголовков таблиц (те мельче и не капсом), чтобы
// два уровня заголовков не сливались друг с другом.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const {
    method,
    path,
    summary,
    queryParams,
    sendsJsonBody,
    bodyFields,
    bodyGroups,
    bodyExample,
    bodyExamples,
    bodyNote,
    responseExample,
    responseFields,
    responseStatus,
    responseNote,
    errors,
  } = endpoint;
  const tone = method === "GET" ? "neutral" : method === "PUT" ? "warn" : method === "DELETE" ? "bad" : "accent";
  const hasBodyContent = !!(bodyFields?.length || bodyGroups?.length || bodyExample || bodyExamples?.length || bodyNote);
  const needsContentType = !!(bodyFields?.length || bodyGroups?.length) || !!sendsJsonBody;
  return (
    <Card className="mt-3">
      <Field label="Метод">
        <Badge tone={tone}>{method}</Badge>
      </Field>

      <Field label="Эндпоинт">
        <code className="font-mono text-[13px] break-all">{path}</code>
      </Field>

      <Field label="Заголовки">
        <HeadersTable needsContentType={needsContentType} />
      </Field>

      {!!queryParams?.length && (
        <Field label="Query-параметры">
          <FieldsTable fields={queryParams} />
        </Field>
      )}

      <Field label="Описание">
        <p className="text-[13px] text-ink-muted m-0">{summary}</p>
      </Field>

      {hasBodyContent && (
        <Disclosure title="Тело запроса">
          {bodyNote && <p className="text-[12.5px] text-ink-muted mt-0 mb-2.5">{bodyNote}</p>}
          {bodyExample && (
            <>
              <div className="text-[12px] text-ink-faint mb-1">Пример</div>
              <pre className="text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 whitespace-pre-wrap break-words font-mono leading-relaxed m-0">{bodyExample}</pre>
            </>
          )}
          {bodyExamples?.map((ex) => (
            <div key={ex.label} className="mt-2.5">
              <div className="text-[12px] text-ink-faint mb-1">{ex.label}</div>
              <pre className="text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 whitespace-pre-wrap break-words font-mono leading-relaxed m-0">{ex.json}</pre>
            </div>
          ))}

          {bodyFields?.length ? <FieldsTable fields={bodyFields} /> : null}
          {bodyGroups?.map((g) => (
            <div key={g.title} className="mt-3 first:mt-0">
              <div className="text-[12.5px] font-semibold text-ink">{g.title}</div>
              <FieldsTable fields={g.fields} />
            </div>
          ))}
        </Disclosure>
      )}

      {(responseExample || !!responseFields?.length) && (
        <Disclosure title="Пример ответа">
          {responseExample && (
            <pre className="text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 whitespace-pre-wrap break-words font-mono leading-relaxed m-0">{responseExample}</pre>
          )}
          {!!responseFields?.length && <FieldsTable fields={responseFields} />}
          {!!responseStatus?.length && (
            <div className="overflow-x-auto pretty-scroll mt-2">
              <table className="w-full border-collapse text-[12.5px] table-fixed">
                <thead>
                  <tr className="text-left text-ink-faint">
                    <th className={`${COL1} pr-3 pb-1.5 font-normal`}>status</th>
                    <th className="pb-1.5 font-normal">Описание</th>
                  </tr>
                </thead>
                <tbody>
                  {responseStatus.map((s) => (
                    <tr key={s.value} className="border-t border-border align-top">
                      <td className={`${COL1} pr-3 py-1.5 font-mono`}>{s.value}</td>
                      <td className="py-1.5 text-ink-muted">{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {responseNote && <p className="text-[12.5px] text-ink-faint mt-2 mb-0">{responseNote}</p>}
        </Disclosure>
      )}

      {!!errors?.length && (
        <Disclosure title="Возможные ошибки">
          <div className="overflow-x-auto pretty-scroll">
            <table className="w-full border-collapse text-[12.5px] table-fixed">
              <thead>
                <tr className="text-left text-ink-faint">
                  <th className={`${COL1} pr-3 pb-1.5 font-normal`}>Код</th>
                  <th className="pb-1.5 font-normal">Когда</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className={`${COL1} pr-3 py-1.5 font-mono text-bad`}>{e.code}</td>
                    <td className="py-1.5 text-ink-muted">{e.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}
    </Card>
  );
}

export default async function ApiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, domain, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  // Какие провайдеры sms/email реально настроены (ключи в «Подключениях») —
  // из них можно выбирать при создании API-ключа. best-effort: отсутствие
  // haskimail_marketing_stream (миграция 0020) не должно ронять bytehand/smsc.
  // Haskimail — один токен на аккаунт, нужен и токен, и ID рассылочного
  // канала (MessageStream), иначе письмо уйдёт в дефолтный транзакционный.
  const admin = createAdminClient();
  const { data: secrets } = await admin
    .from("project_secrets")
    .select("bytehand_service_key, smsc_login, smsc_password, haskimail_server_token")
    .eq("project_id", id)
    .maybeSingle();
  const { data: streamSecret, error: streamErr } = await admin
    .from("project_secrets")
    .select("haskimail_marketing_stream")
    .eq("project_id", id)
    .maybeSingle();
  const smscReady = !!secrets?.smsc_login && !!secrets?.smsc_password;
  const haskimailReady = !!secrets?.haskimail_server_token && !streamErr && !!streamSecret?.haskimail_marketing_stream;
  const providerOptions = {
    sms: [
      ...(secrets?.bytehand_service_key ? [{ value: "bytehand", label: "Bytehand" }] : []),
      ...(smscReady ? [{ value: "smsc", label: "SMSC.ru" }] : []),
    ],
    email: [
      ...(haskimailReady ? [{ value: "haskimail", label: "Haskimail" }] : []),
      ...(smscReady ? [{ value: "smsc", label: "SMSC.ru" }] : []),
    ],
  };

  // best-effort: sms_provider/email_provider — колонки миграции 0019,
  // отсутствие не должно ронять список ключей.
  const { data: keysFull, error: keysErr } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, is_active, last_used_at, created_at, sms_provider, email_provider")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  const { data: keysBasic } = keysErr
    ? await supabase
        .from("api_keys")
        .select("id, name, key_prefix, is_active, last_used_at, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
    : { data: null };
  const keys = keysFull ?? keysBasic;

  return (
    <main className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold">API</h1>

      <ApiKeys projectId={id} initial={keys ?? []} providerOptions={providerOptions} />

      <section className="mt-10">
        <h2 className="text-lg font-semibold mb-1">Эндпоинты</h2>

        <ButtonLink href="/api/v1/docs" variant="secondary" size="sm" className="mt-1 mb-3 w-fit" download="sendera-api.md">
          <IconDownload size={15} stroke={1.8} />
          Скачать API.md для ИИ-агентов
        </ButtonLink>

        {API_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="text-[13.5px] font-semibold mt-6 mb-1">{group.title}</div>
            {group.endpoints.map((e) => (
              <EndpointCard key={`${e.method} ${e.path}`} endpoint={e} />
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}
