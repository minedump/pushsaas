"use client";

import { useState } from "react";
import { IconX, IconBook2 } from "@tabler/icons-react";
import { Modal } from "@/app/ui";

// Справка "что передавать в sendera.event()" — кнопка + попап, для формы
// событийной автоматизации. Отдельно от ContextDocs (та про Liquid-контекст
// уже полученного payload; эта — про сам payload: какие имена событий и
// поля распознаёт платформа). Общая для всех типов событий, не завязана на
// конкретную карточку.
export function EventTrackingDocs() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline cursor-pointer w-fit"
      >
        <IconBook2 size={16} stroke={1.8} />
        Какие данные передавать в событии
      </button>
      {open && <EventTrackingDocsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function EventTrackingDocsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0">Какие данные передавать в событии</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-4 text-[13px] text-ink-muted">
        <section>
          <div className="font-semibold text-ink mb-1">1. Как вообще приходит событие</div>
          <p className="m-0">
            Сайт вызывает <code className="font-mono">sendera.event(&apos;имя_события&apos;, {"{ ...поля }"})</code> (embed-скрипт, раздел
            «Виджет») — работает только у устройств с активной push-подпиской, без неё событие никуда не уходит. «Когда произошло» в этой
            форме должно СОВПАДАТЬ с именем события буквально — <code className="font-mono">cart_updated</code> ≠{" "}
            <code className="font-mono">cartUpdated</code>. Поля <code className="font-mono">payload</code> — произвольные, платформа не
            проверяет их состав, кроме нескольких распознаваемых имён ниже.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">2. Просмотр товара/категории — только смотрели, без отмены</div>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`sendera.event('product_viewed', { product_id: 'SKU-123' })
sendera.event('category_viewed', { category_id: '42' })
sendera.event('category_viewed', { category_ids: ['42', '43'] })`}
          </pre>
          <p className="m-0 mt-1.5">
            Только «посмотрели» — отдельного события «убрать из просмотренного» нет и не нужно (никто не «отменяет» просмотр).{" "}
            <code className="font-mono">product_id</code>/<code className="font-mono">product_ids</code> резолвятся в{" "}
            <code className="font-mono">{"{{ product }}"}</code>/<code className="font-mono">{"{{ products }}"}</code>.{" "}
            <code className="font-mono">category_id</code>/<code className="font-mono">category_ids</code> резолвятся сразу в ДВА
            неймспейса параллельно — <code className="font-mono">{"{{ category }}"}</code>/<code className="font-mono">{"{{ categories }}"}</code>{" "}
            (раздел фида <code className="font-mono">{"<categories>"}</code>) и <code className="font-mono">{"{{ collection }}"}</code>/
            <code className="font-mono">{"{{ collections }}"}</code> (<code className="font-mono">{"<collections>"}</code> — картинка/ссылка/
            описание, готово для карточки) — id один и тот же, платформа сама ищет его в обоих разделах фида, какой совпал — тот и заполнится
            (см. «Как работать с контекстом»).
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">3. Корзина и избранное — только полный список целиком</div>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`sendera.event('cart_updated', { product_ids: ['1', '2', '3'] })
sendera.event('favorite_updated', { product_ids: ['1', '4'] })`}
          </pre>
          <p className="m-0 mt-1.5">
            Оба — снимок ВСЕГО списка целиком при каждом изменении, а не «добавили один»/«убрали один»: сайт каждый раз шлёт полный текущий{" "}
            <code className="font-mono">product_ids</code>, платформа сама вычисляет разницу и приводит сохранённый список в соответствие
            (то, чего в новом наборе нет, — удаляется). Копится персональный список контакта — используется вебхук-триггерами «цена
            снижена»/«товар в наличии» (раздел «Триггерные», список <code className="font-mono">favorite</code>/<code className="font-mono">cart</code>),
            не влияет на эту карточку напрямую.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">4. Свой именованный список — add/remove по отдельности</div>
          <p className="m-0">
            Например «уведомить о поступлении» — в отличие от корзины/избранного, тут нет понятия «текущий полный список» на стороне сайта,
            поэтому события раздельные, любое своё имя вместо <code className="font-mono">{"{name}"}</code>:
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`sendera.event('restock_added', { product_id: 'SKU-123' })
sendera.event('restock_removed', { product_id: 'SKU-123' })`}
          </pre>
          <p className="m-0 mt-1.5">
            Список = результат всех пришедших <code className="font-mono">_added</code>/<code className="font-mono">_removed</code> событий
            по этому имени (то же самое, что уже сохранено — повторный <code className="font-mono">_added</code> ничего не дублирует). Имя
            не должно совпадать с зарезервированными — <code className="font-mono">cart</code>/<code className="font-mono">favorite</code>/
            <code className="font-mono">viewed</code>. Подключается в Триггерных → «По списку товара» → поле «Список» (то же имя,{" "}
            <code className="font-mono">restock</code> в примере).
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">5. Очистка накопленного — всегда, автоматически</div>
          <p className="m-0">
            Для просмотров (п.2): карточка на <code className="font-mono">product_viewed</code>/<code className="font-mono">category_viewed</code>{" "}
            всегда идёт по накопительному флоу — никакой настройки для этого включать не нужно. При срабатывании подставляется ВЕСЬ список,
            накопленный с прошлой отправки (<code className="font-mono">{"{{ products }}"}</code>/<code className="font-mono">{"{{ categories }}"}</code>),
            и сразу же очищается — следующий цикл просмотров начинается с нуля, то же самое повторно не уйдёт. Ничего не накопилось (гонка/
            первый показ до записи) — уходит как обычно, с одиночным <code className="font-mono">product</code>/<code className="font-mono">category</code>{" "}
            из самого события.
          </p>
          <p className="m-0 mt-1.5">
            Для корзины/избранного (п.3) отдельная очистка не нужна — «отменяющее» событие (п.6, например{" "}
            <code className="font-mono">order_placed</code> у карточки на <code className="font-mono">cart_updated</code>) само очищает
            сохранённый список этой карточки, когда срабатывает: заказ оформлен — считаем, что корзина/избранное разрешились, дальше копится
            заново с чистого листа. Клиент вернётся на сайт и снова тронет корзину — придёт свежий <code className="font-mono">cart_updated</code>{" "}
            и запустит карточку повторно. Свой именованный список (п.4) этой автоочисткой не затрагивается — add/remove по нему ведёт сам
            мерчант осознанно, поводов для авто-очистки по заказу нет.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">6. Отмена по другому событию</div>
          <p className="m-0">
            «Если НЕ произошло» — список имён через запятую (например <code className="font-mono">order_placed</code>): если ЭТО событие
            придёт от того же контакта раньше, чем истечёт задержка «Подождать», запланированная отправка отменяется целиком (карточка
            «брошенная корзина» с задержкой 1 час, отменяемая по <code className="font-mono">order_placed</code> — классический пример; см.
            п.5 про заодно очищаемый список).
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">7. Свои произвольные события</div>
          <p className="m-0">
            Любое имя, любой набор полей, не из списков выше — <code className="font-mono">sendera.event(&apos;promo_shown&apos;, {"{ promo_code: 'SALE20' }"})</code>.
            Поля доступны в шаблоне как есть, без настройки: <code className="font-mono">{"{{ promo_code }}"}</code> или{" "}
            <code className="font-mono">{"{{ automation.promo_code }}"}</code> (см. «Как работать с контекстом»). Реальный payload уже
            пришедших событий (в том числе для отладки формата) видно в «Журнале».
          </p>
        </section>
      </div>
    </Modal>
  );
}
