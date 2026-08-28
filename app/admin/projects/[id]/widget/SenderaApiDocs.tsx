"use client";

import { useState } from "react";
import { IconX, IconBook2 } from "@tabler/icons-react";
import { Modal } from "@/app/ui";

// Справка по методам window.sendera.* — раньше единственное упоминание было
// вскользь в «Настройках» (sendera.subscribe() + завязка на
// data-sendera="manual", которую мы убрали — своя кнопка теперь просто
// требует выключить нашу тумблером выше). Остальные методы (event/identify/
// isSubscribed/isAuthenticated) нигде не документировались вообще.
export function SenderaApiDocs() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline cursor-pointer w-fit mt-2"
      >
        <IconBook2 size={16} stroke={1.8} />
        Методы основного скрипта
      </button>
      {open && <SenderaApiDocsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SenderaApiDocsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0">Методы sendera.*</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-4 text-[13px] text-ink-muted">
        <section>
          <div className="font-semibold text-ink mb-1">Свою кнопку вместо нашей</div>
          <p className="m-0">
            Основной скрипт (раздел «Настройки») сам ничего не рисует на странице — плавающую кнопку и плашку добавляют отдельные
            переключатели здесь, в «Виджеты». Чтобы сделать свою кнопку/ссылку: выключите тумблер нужной механики выше и вызывайте{" "}
            <code className="font-mono">sendera.subscribe()</code> из своего обработчика клика — методы всегда доступны, включены наши
            виджеты или нет.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">sendera.subscribe()</div>
          <p className="m-0">
            Запрашивает у браузера разрешение на уведомления и подписывает это устройство. Возвращает Promise, ничего не рисует —
            визуальный отклик (смена текста кнопки и т.п.) на вашей стороне.
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
            {`document.getElementById('my-btn').addEventListener('click', function(){\n  sendera.subscribe();\n});`}
          </pre>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">sendera.isSubscribed()</div>
          <p className="m-0">
            Promise&lt;boolean&gt; — подписано ли ЭТО устройство прямо сейчас. Проверка целиком на стороне браузера, сети не требует.
            Пригодится, чтобы не показывать свою кнопку подписки уже подписавшимся.
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
            {`sendera.isSubscribed().then(function(yes){\n  if(yes) myButton.style.display = 'none';\n});`}
          </pre>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">sendera.event(name, payload)</div>
          <p className="m-0">
            Логирует произвольное событие подписчика — для событийных автоматизаций и персонализации в шаблонах. Полный список
            распознаваемых имён (просмотр товара, корзина, избранное и т.п.) — в разделе «Автоматизации» → «Событийные» → «Какие данные
            передавать в событии».
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
            {`sendera.event('product_viewed', { product_id: 'SKU-123' });`}
          </pre>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">sendera.identify({"{ phone, email, name, insales_client_id }"})</div>
          <p className="m-0">
            Довязывает известные данные покупателя (например, после входа в личный кабинет магазина) к уже подписанному устройству — не
            заводит новую привязку телефон/email сама по себе, только обогащает уже подтверждённую кодом.{" "}
            <code className="font-mono">insales_client_id</code> (можно и camelCase — <code className="font-mono">insalesClientId</code>)
            привязывает id покупателя из InSales, если он у вас есть на странице.
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
            {`sendera.identify({ name: 'Иван', phone: '+79991234567', insales_client_id: '12345' });`}
          </pre>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">sendera.isAuthenticated()</div>
          <p className="m-0">
            Promise&lt;{"{ authenticated, phone, email }"}&gt; — привязано ли устройство к телефону и/или email через вход по коду
            (раздел «Авторизация»). Без самих значений, только факт привязки.
          </p>
        </section>
      </div>
    </Modal>
  );
}
