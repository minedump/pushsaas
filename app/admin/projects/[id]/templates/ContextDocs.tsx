"use client";

import { useState } from "react";
import { IconX, IconBook2 } from "@tabler/icons-react";
import { Modal } from "@/app/ui";

// Справка по Liquid-контексту — кнопка + попап, не занимает место в форме
// шаблона/рассылки, пока не нужна. Контент описывает namespaced-модель из
// mergeTemplateContext/splitTemplateData (lib/sender.ts): три источника
// контекста (template/context/automation) хранятся и подставляются РАЗДЕЛЬНО,
// не сливаются в один плоский объект — иначе одноимённый ключ на рассылке
// тихо перекрывал бы значение из контекста шаблона, без какого-либо признака,
// что оно вообще было (баг, который эта модель как раз устраняет).
//
// variant меняет, на какой источник ссылается "«Добавить контекст» выше" —
// в форме шаблона это template.*, в форме рассылки (ручная кампания) рядом с
// кнопкой стоит СВОЙ контекст рассылки, то есть context.* (см. п.1/4/5).
// Остальной текст (клиент/товар/категории) от формы не зависит.
export function ContextDocs({ variant = "template" }: { variant?: "template" | "campaign" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline cursor-pointer w-fit"
      >
        <IconBook2 size={16} stroke={1.8} />
        Как работать с контекстом
      </button>
      {open && <ContextDocsModal variant={variant} onClose={() => setOpen(false)} />}
    </>
  );
}

function ContextDocsModal({ variant, onClose }: { variant: "template" | "campaign"; onClose: () => void }) {
  const isCampaign = variant === "campaign";
  // Неймспейс СВОЕГО контекста этой формы (рядом с кнопкой) — используется в
  // примерах п.1/4/5, чтобы «выше»/«в этом поле» указывало на реальное поле
  // формы, а не на контекст, которого здесь нет.
  const ownNs = isCampaign ? "context" : "template";
  return (
    <Modal onClose={onClose} className="max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0">Как работать с контекстом</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-4 text-[13px] text-ink-muted">
        <section>
          <div className="font-semibold text-ink mb-1">1. Три источника контекста — не конкурируют, а складываются</div>
          <p className="m-0">
            У сообщения может быть до трёх источников контекста одновременно, каждый в своём пространстве имён — один и тот же ключ в разных
            источниках не перекрывает другие, все доступны сразу:
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{isCampaign
  ? `{{ context.percent }}     — из контекста ЭТОЙ рассылки («Добавить контекст» выше)
{{ template.percent }}    — из контекста выбранного шаблона, если он используется (раздел «Шаблоны»)
{{ automation.percent }}  — не для ручных рассылок, только у Событийных/Триггерных автоматизаций`
  : `{{ template.percent }}    — из контекста ЭТОГО шаблона («Добавить контекст» выше)
{{ context.percent }}     — из контекста рассылки (поле «Добавить контекст» в конструкторе рассылки)
{{ automation.percent }}  — из события/вебхука, которым сработала автоматизация`}
          </pre>
          <p className="m-0 mt-1.5">
            <code className="font-mono">template.*</code> подставляется при любой отправке этим шаблоном — и в Приветственных/Событийных/
            Триггерных, и в ручной рассылке. <code className="font-mono">context.*</code> — только там, где для этой конкретной отправки задан
            свой контекст{isCampaign ? " (эта форма)" : " (обычно ручная рассылка)"}. <code className="font-mono">automation.*</code> — только у
            Событийных/Триггерных, из payload события (см. п.6){isCampaign ? " — в ручной рассылке всегда пусто" : ""}. Источника нет —
            обращение просто ничего не выведет, ошибки не будет.
          </p>
          <p className="m-0 mt-1.5">
            Контекст рассылки/события ещё и доступен без префикса (для совместимости) — <code className="font-mono">{"{{ percent }}"}</code>{" "}
            равнозначно <code className="font-mono">{"{{ context.percent }}"}</code> или <code className="font-mono">{"{{ automation.percent }}"}</code>,
            смотря откуда пришла отправка. А вот контекст ШАБЛОНА без префикса не подставляется никогда — именно это и убирает конкуренцию:
            заведите один и тот же ключ {isCampaign ? "и в выбранном шаблоне, и здесь, на рассылке" : "и в шаблоне, и на рассылке"} — оба
            значения останутся доступны раздельно как <code className="font-mono">template.percent</code> и{" "}
            <code className="font-mono">context.percent</code>/<code className="font-mono">{"{{ percent }}"}</code>.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">2. Контекст клиента — передаётся всегда</div>
          <p className="m-0">
            Настраивать не нужно, доступно в любом реальном сообщении (без префикса, отдельно от трёх источников выше):{" "}
            <code className="font-mono">{"{{ name }}"}</code>, <code className="font-mono">{"{{ phone }}"}</code>,{" "}
            <code className="font-mono">{"{{ email }}"}</code>, <code className="font-mono">{"{{ tags }}"}</code> (список тегов —{" "}
            <code className="font-mono">{'{{ tags | join: ", " }}'}</code>), плюс любой кастомный атрибут контакта — сразу по имени:{" "}
            <code className="font-mono">{"{{ ваш_атрибут }}"}</code>.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">3. Конкретный товар — {"{{ product }}"}</div>
          <p className="m-0">
            <code className="font-mono">{"{{ product.name }}"}</code>, <code className="font-mono">{"{{ product.price }}"}</code>,{" "}
            <code className="font-mono">{"{{ product.old_price }}"}</code>, <code className="font-mono">{"{{ product.image_url }}"}</code>,{" "}
            <code className="font-mono">{"{{ product.url }}"}</code>, <code className="font-mono">{"{{ product.group_id }}"}</code> (объединяет
            варианты — размер/цвет), <code className="font-mono">{"{{ product.categories }}"}</code> (п.6),{" "}
            <code className="font-mono">{"{{ product.collections }}"}</code> (п.7) — списки названий.
          </p>
          <p className="m-0 mt-1.5">
            Кастомные параметры фида — через скобки, если в названии пробел:{" "}
            <code className="font-mono">{'{{ product.params["Цвет товара"] }}'}</code>.
          </p>
          <p className="m-0 mt-1.5">
            Появляется само в Событийных, когда в событии передан <code className="font-mono">product_id</code> (сайт вызвал{" "}
            <code className="font-mono">sendera.event(&apos;product_viewed&apos;, {"{ product_id: ... }"})</code>), либо выберите товар
            вручную/правилом «N новых» в «Товары в сообщении» (Приветственные/Событийные) или в конструкторе рассылки.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">4. Список товаров — {"{{ products }}"}</div>
          <p className="m-0">
            Перебор циклом: <code className="font-mono">{"{% for product in products %}{{ product.name }} — {{ product.price }} ₽{% endfor %}"}</code>.
          </p>
          <p className="m-0 mt-1.5">
            Собирается автоматически (несколько <code className="font-mono">product_id</code> в событии — брошенная корзина) или выбором «N
            новых»/вручную — в этих случаях доступно без префикса, как в примере выше. Свой список можно объявить и вручную — но в поле
            «Добавить контекст» {isCampaign ? "этой рассылки" : "этого шаблона"} (п.1) он попадёт в неймспейс{" "}
            <code className="font-mono">{ownNs}.*</code>, а не в бары <code className="font-mono">products</code>:
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`{
  "products": [
    { "name": "Товар 1", "price": 1990, "url": "https://..." },
    { "name": "Товар 2", "price": 2490, "url": "https://..." }
  ]
}`}
          </pre>
          <p className="m-0 mt-1.5">
            → в письме: <code className="font-mono">{`{% for p in ${ownNs}.products %}{{ p.name }}{% endfor %}`}</code>. Поля берутся любые,
            какие укажете в JSON — это чистый ручной ввод, без привязки к фиду.
          </p>
          <p className="m-0 mt-1.5">
            Если у товара есть фид (раздел «Настройки») — элемент с полем <code className="font-mono">id</code> вместо ручных полей подтянет
            ВСЕ атрибуты из кеша фида, свежие на момент отправки (остальные поля рядом с <code className="font-mono">id</code>, если написали,
            — игнорируются, побеждает фид). Элементы без <code className="font-mono">id</code> в том же списке остаются чистым ручным вводом —
            можно смешивать:
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`{
  "products": [
    { "id": "SKU-123" },
    { "name": "Акционный товар вне фида", "price": 0 }
  ]
}`}
          </pre>
          <p className="m-0 mt-1.5">
            Первый элемент придёт с актуальными <code className="font-mono">name/price/old_price/image_url/url/categories/params</code> из
            фида (id ищется по значению <code className="font-mono">external_id</code> в фиде), второй — ровно как написан. Тот же приём
            работает и для одиночного <code className="font-mono">product</code> (п.3): <code className="font-mono">{'{ "product": { "id": "SKU-123" } }'}</code>.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">5. Совмещаем контексты одновременно</div>
          {isCampaign ? (
            <>
              <p className="m-0">
                Пример: в «Товары в сообщении» выбраны конкретные товары — <code className="font-mono">{"{{ products }}"}</code>/
                <code className="font-mono">{"{{ product }}"}</code> уже резолвлены (см. п.3–4). Хотите ДОПОЛНИТЕЛЬНО показать «Похожие
                товары» — свой список, не связанный с этим выбором, впишите его в контекст этой рассылки (п.1):
              </p>
              <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`{ "similar_products": [{ "name": "...", "price": 0 }] }`}
              </pre>
              <p className="m-0 mt-1.5">И используйте оба сразу в тексте письма — они из разных источников, друг другу не мешают:</p>
              <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`{% for p in products %}{{ p.name }}{% endfor %}

Похожее:
{% for p in context.similar_products %}
  {{ p.name }} — {{ p.price }} ₽
{% endfor %}`}
              </pre>
              <p className="m-0 mt-1.5">
                <code className="font-mono">products</code> — из «Товары в сообщении» (бары, см. п.3–4), <code className="font-mono">context.similar_products</code>{" "}
                — из контекста этой рассылки (п.1). Работает в любой ручной рассылке — с шаблоном или без.
              </p>
            </>
          ) : (
            <>
              <p className="m-0">
                Пример: письмо о брошенном просмотре товара — <code className="font-mono">{"{{ product }}"}</code> резолвится САМ из события
                (сайт передал <code className="font-mono">product_id</code>, см. п.6). Хотите заодно показать «Популярные товары» — свой
                список, не связанный с событием, объявленный прямо в контексте этого шаблона (п.1):
              </p>
              <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`{ "popular_products": [{ "name": "...", "price": 0 }] }`}
              </pre>
              <p className="m-0 mt-1.5">И используйте оба сразу в тексте письма — они из разных источников, друг другу не мешают:</p>
              <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`Вы смотрели: {{ product.name }}

Популярное:
{% for p in template.popular_products %}
  {{ p.name }} — {{ p.price }} ₽
{% endfor %}`}
              </pre>
              <p className="m-0 mt-1.5">
                <code className="font-mono">product</code> резолвится из события (бары, см. п.3), <code className="font-mono">template.popular_products</code>{" "}
                — из контекста шаблона (п.1). Работает везде, где используется этот шаблон — и в автоматизациях, и в ручной рассылке.
              </p>
            </>
          )}
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">6. Категории — {"{{ category }}"}/{"{{ categories }}"}</div>
          <p className="m-0">
            У товара — <code className="font-mono">{"{{ product.categories }}"}</code> (список названий, не id):{" "}
            <code className="font-mono">{'{{ product.categories | join: ", " }}'}</code> или{" "}
            <code className="font-mono">{"{% for cat in product.categories %}{{ cat }}{% endfor %}"}</code>.
          </p>
          <p className="m-0 mt-1.5">
            Отдельно от товара — конкретная категория как объект, тем же способом, что и <code className="font-mono">{"{{ product }}"}</code>{" "}
            (п.3): <code className="font-mono">{"{{ category.name }}"}</code>, <code className="font-mono">{"{{ category.external_id }}"}</code>,{" "}
            <code className="font-mono">{"{{ category.parent_id }}"}</code>. Появляется само в Событийных, когда в событии передан{" "}
            <code className="font-mono">category_id</code> (сайт вызвал{" "}
            <code className="font-mono">sendera.event(&apos;category_viewed&apos;, {"{ category_id: ... }"})</code>) — резолвится из кеша
            фида (раздел «Настройки»), как и товар. Несколько категорий сразу — <code className="font-mono">category_ids</code> (массив) →{" "}
            <code className="font-mono">{"{{ categories }}"}</code>, перебор циклом:{" "}
            <code className="font-mono">{"{% for cat in categories %}{{ cat.name }}{% endfor %}"}</code>.
          </p>
          <p className="m-0 mt-1.5">
            Как и у товаров (п.4), можно обогатить свой список из id: элемент с полем <code className="font-mono">id</code> в контексте
            шаблона/рассылки подтянет актуальное имя из фида —{" "}
            <code className="font-mono">{'{ "categories": [{ "id": "42" }] }'}</code> → <code className="font-mono">{`{% for c in ${ownNs}.categories %}{{ c.name }}{% endfor %}`}</code>.
          </p>
          <p className="m-0 mt-1.5">
            Если событие прислало что-то своё, не <code className="font-mono">category_id</code>/<code className="font-mono">category_ids</code>{" "}
            (например произвольный <code className="font-mono">category_name</code>) — готового резолва для этого нет, поле доступно как есть,
            без префикса и как <code className="font-mono">automation.*</code> (п.1): <code className="font-mono">{"{{ category_name }}"}</code>{" "}
            или <code className="font-mono">{"{{ automation.category_name }}"}</code>. Реальный payload уже пришедших событий видно в
            «Журнале» — подробнее про сами события см. кнопку «Какие данные передавать в событии» у событийной автоматизации.
          </p>
          <p className="m-0 mt-1.5">
            В правиле «N новых» (Товары в сообщении) фильтр по категории ищет по названию — том же, что в{" "}
            <code className="font-mono">product.categories</code>, не по id.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">7. Коллекции — {"{{ collection }}"}/{"{{ collections }}"}</div>
          <p className="m-0">
            Не категория (не иерархия) — тематическая подборка с картинкой(-ами)/ссылкой/описанием, из раздела{" "}
            <code className="font-mono">{"<collections>"}</code> фида (см. «Какой формат у фида» в Настройках; формат — как у Яндекс.Директ,
            один товар может входить сразу в несколько). Резолвится тем же способом, что товар/категория (п.3/6):{" "}
            <code className="font-mono">{"{{ collection.name }}"}</code>, <code className="font-mono">{"{{ collection.description }}"}</code>,{" "}
            <code className="font-mono">{"{{ collection.url }}"}</code>, <code className="font-mono">{"{{ collection.image_url }}"}</code>{" "}
            (первая картинка) или <code className="font-mono">{"{{ collection.images }}"}</code> (список, если картинок несколько) — из ТЕХ
            ЖЕ <code className="font-mono">category_id</code>/<code className="font-mono">category_ids</code> в событии/трекинге, что и
            категория (п.6) — отдельного <code className="font-mono">collection_id</code> нет, сайт передаёт один id, ищем его сразу в обоих
            разделах фида (категории и коллекции — разные вещи, но идентификатор из трекинга один и тот же). Вручную — через{" "}
            <code className="font-mono">id</code> в контексте (как в п.4/6), но уже под своим ключом{" "}
            <code className="font-mono">collection</code>: <code className="font-mono">{'{ "collection": { "id": "dukhi1" } }'}</code>.
          </p>
          <p className="m-0 mt-1.5">Карточка коллекции в письме — типичный пример:</p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`{% for c in collections %}
  <a href="{{ c.url }}">
    <img src="{{ c.image_url }}" alt="{{ c.name }}">
    <h3>{{ c.name }}</h3>
    <p>{{ c.description }}</p>
  </a>
{% endfor %}`}
          </pre>
          <p className="m-0 mt-1.5">
            У товара — какие коллекции в него входят, списком названий: <code className="font-mono">{"{{ product.collections }}"}</code>{" "}
            (см. п.3), тем же способом, что и <code className="font-mono">product.categories</code>.
          </p>
        </section>
      </div>
    </Modal>
  );
}
