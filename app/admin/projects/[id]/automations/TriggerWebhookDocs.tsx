"use client";

import { useState } from "react";
import { IconX, IconBook2 } from "@tabler/icons-react";
import { Modal } from "@/app/ui";
import CopyBox from "../CopyBox";

// Справка "какой вебхук поставить и откуда взять ключ" — для формы
// триггерной рассылки. Раньше этот текст жил отдельным разделом на
// странице «API», перенесён сюда контекстно — ссылку добавляют именно
// в момент создания автоматизации, а не заранее.
export function TriggerWebhookDocs({ projectId, appUrl, automationKey }: { projectId: string; appUrl: string; automationKey: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline cursor-pointer w-fit"
      >
        <IconBook2 size={16} stroke={1.8} />
        Какой вебхук установить и откуда взять ключ
      </button>
      {open && <TriggerWebhookDocsModal projectId={projectId} appUrl={appUrl} automationKey={automationKey} onClose={() => setOpen(false)} />}
    </>
  );
}

function TriggerWebhookDocsModal({
  projectId,
  appUrl,
  automationKey,
  onClose,
}: {
  projectId: string;
  appUrl: string;
  automationKey: string;
  onClose: () => void;
}) {
  const exampleUrl = `${appUrl}/api/v1/trigger?key=wpk_ВАШ_КЛЮЧ&automation=${automationKey || "ваш_ключ"}`;
  return (
    <Modal onClose={onClose} className="max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0">Какой вебхук установить и откуда взять ключ</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-4 text-[13px] text-ink-muted">
        <section>
          <div className="font-semibold text-ink mb-1">1. Один эндпоинт на любое событие</div>
          <p className="m-0">
            В настройках магазина InSales добавьте вебхук на адрес{" "}
            <code className="font-mono">{appUrl}/api/v1/trigger</code> — один и тот же для всех триггерных рассылок проекта, разные
            рассылки различаются параметром <code className="font-mono">automation</code> в ссылке.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">2. Ключ</div>
          <p className="m-0">
            Возьмите API-ключ проекта в разделе{" "}
            <a href={`/admin/projects/${projectId}/api`} className="text-accent">
              API
            </a>{" "}
            (создайте, если ещё нет) и подставьте вместо <code className="font-mono">ВАШ_КЛЮЧ</code> — либо параметром{" "}
            <code className="font-mono">?key=</code>, либо прямо в адресе:{" "}
            <code className="font-mono">https://wpk_КЛЮЧ@host/…</code>.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">3. Ссылка для этой рассылки</div>
          <p className="m-0 mb-1">
            Параметр <code className="font-mono">automation</code> — значение поля «Ключ» выше на этой форме:
          </p>
          <CopyBox text={exampleUrl} />
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">4. Телефон, статус и поля заказа</div>
          <p className="m-0">
            Путь к телефону, условия по статусу и любые поля заказа задаются прямо в этой форме ниже — отдельно ничего в самой ссылке
            указывать не нужно. Любое поле из тела вебхука доступно в шаблоне как <code className="font-mono">{"{{ поле }}"}</code>, в т.ч.
            вложенное — <code className="font-mono">{"{{ client.name }}"}</code>.
          </p>
        </section>
      </div>
    </Modal>
  );
}
