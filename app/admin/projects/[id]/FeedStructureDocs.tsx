"use client";

import { useState } from "react";
import { IconX, IconBook2 } from "@tabler/icons-react";
import { Modal } from "@/app/ui";

// Справка по структуре товарного фида — кнопка + попап, та же схема, что и
// ContextDocs/EventTrackingDocs. Формат — стандартный YML (Яндекс.Маркет,
// он же ЯМL, https://yandex.ru/support/partnermarket/yml/about-yml.html) —
// парсер (lib/productFeed.ts, parseYmlFeed/parseCategories) читает ровно то,
// что описано тут: не своя, придуманная схема, а тот же YML, что уже
// используется для Яндекс.Директ/Маркет — обычно тот же файл, что мерчант
// готовит для рекламы, подходит и сюда без переделки.
export function FeedStructureDocs() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline cursor-pointer w-fit"
      >
        <IconBook2 size={16} stroke={1.8} />
        Какой формат у фида
      </button>
      {open && <FeedStructureDocsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedStructureDocsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border shrink-0">
        <h3 className="text-base font-semibold m-0">Какой формат у фида</h3>
        <button type="button" onClick={onClose} className="p-1 text-ink-faint hover:text-ink cursor-pointer shrink-0" title="Закрыть">
          <IconX size={18} stroke={1.8} />
        </button>
      </div>

      <div className="pretty-scroll flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col gap-4 text-[13px] text-ink-muted">
        <section>
          <div className="font-semibold text-ink mb-1">1. Формат — обычный YML (Яндекс.Маркет / ЯМL)</div>
          <p className="m-0">
            Тот же формат, что мерчант уже готовит для Яндекс.Директ/Маркет (штатный экспорт большинства CMS, включая InSales,
            называется «выгрузка для Яндекс.Маркета» или «YML») — отдельный файл под Sendera заводить не нужно, подойдёт готовый.
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-08-24 12:00">
  <shop>
    <categories>
      <category id="1">Одежда</category>
      <category id="2" parentId="1">Брюки</category>
    </categories>
    <offers>
      <offer id="SKU-123" group_id="MODEL-1">
        <name>Брюки классические</name>
        <price>2990</price>
        <oldprice>3990</oldprice>
        <picture>https://site.ru/img/123.jpg</picture>
        <url>https://site.ru/product/123</url>
        <categoryId>2</categoryId>
        <param name="Цвет товара">Чёрный</param>
        <vendor>Бренд</vendor>
      </offer>
    </offers>
  </shop>
</yml_catalog>`}
          </pre>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">2. Товар — {"<offer>"}</div>
          <p className="m-0">
            Обязательно: атрибут <code className="font-mono">id</code> (уникален в рамках фида — это и есть{" "}
            <code className="font-mono">product_id</code> для трекинга/контекста, см. «Как работать с контекстом» у шаблона) и{" "}
            <code className="font-mono">{"<name>"}</code> (если имени нет — берётся <code className="font-mono">{"<vendor>"}</code> +{" "}
            <code className="font-mono">{"<model>"}</code>, тоже валидно).
          </p>
          <p className="m-0 mt-1.5">
            Необязательно: <code className="font-mono">{"<price>"}</code>, <code className="font-mono">{"<oldprice>"}</code> (для «было/стало»),{" "}
            <code className="font-mono">{"<picture>"}</code>, <code className="font-mono">{"<url>"}</code>,{" "}
            <code className="font-mono">{"<param name=\"…\">…</param>"}</code> — любое количество, ключ — атрибут{" "}
            <code className="font-mono">name</code>, попадает в <code className="font-mono">{"{{ product.params[\"…\"] }}"}</code>.{" "}
            <code className="font-mono">{"<vendor>"}</code>/<code className="font-mono">{"<manufacturer>"}</code>/
            <code className="font-mono">{"<country_of_origin>"}</code>/<code className="font-mono">{"<weight>"}</code> — тоже попадают в{" "}
            <code className="font-mono">params</code>, как обычные кастомные атрибуты.
          </p>
          <p className="m-0 mt-1.5">
            Атрибут <code className="font-mono">group_id</code> прямо на <code className="font-mono">{"<offer>"}</code> — объединяет варианты
            одной модели (размер/цвет) в один <code className="font-mono">{"{{ product.group_id }}"}</code>; необязательный, своя надстройка
            над стандартом (в самом YML-спеке варианты группируются иначе — если фид генерирует то, что описано выше, просто добавьте этот
            атрибут при экспорте, или оставьте пустым, если варианты объединять не нужно).
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">3. Категории — {"<categories>"}</div>
          <p className="m-0">
            Иерархическая классификация. Секция <code className="font-mono">{"<categories>"}</code> — список{" "}
            <code className="font-mono">{'<category id="…">Имя</category>'}</code>, вложенность — через необязательный{" "}
            <code className="font-mono">parentId</code> (ссылается на <code className="font-mono">id</code> родителя). Каждый{" "}
            <code className="font-mono">{"<offer>"}</code> ссылается на свою категорию (или несколько) тегом{" "}
            <code className="font-mono">{"<categoryId>"}</code> — если товар в нескольких категориях сразу, повторите тег:
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`<offer id="SKU-123">
  ...
  <categoryId>2</categoryId>
  <categoryId>7</categoryId>
</offer>`}
          </pre>
          <p className="m-0 mt-1.5">
            Это и попадает в <code className="font-mono">{"{{ product.categories }}"}</code> (список имён категорий этого товара). Категории
            резолвятся в собственный объект тем же способом, что и товары — <code className="font-mono">{"{{ category.name }}"}</code>,{" "}
            <code className="font-mono">{"{{ category.parent_id }}"}</code> — когда в событии/трекинге передан{" "}
            <code className="font-mono">category_id</code>/<code className="font-mono">category_ids</code> (значение —{" "}
            <code className="font-mono">id</code> из этой самой секции), см. «Как работать с контекстом» у шаблона и «Какие данные передавать
            в событии» у событийной автоматизации.
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">4. Коллекции — {"<collections>"}</div>
          <p className="m-0">
            Не иерархия, как категории, а тематическая подборка товаров с картинкой/ссылкой/описанием — специально для карточек в письме
            («Хиты продаж», «Новинки недели» и т.п.). Формат — стандартный раздел YML для Яндекс.Директ (
            <a
              href="https://yandex.ru/support/direct/ru/feeds/requirements-yml#collections"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              требования Яндекса к YML, раздел «Коллекции»
            </a>
            ) — идёт после <code className="font-mono">{"<offers>"}</code>, если такой раздел уже есть в фиде под рекламу, менять ничего не
            нужно:
          </p>
          <pre className="mt-1.5 mb-0 text-[12px] bg-surface-2 border border-border rounded-lg p-2.5 overflow-x-auto">
{`<collections>
  <collection id="dukhi1">
    <url>https://site.ru/catalog/dukhi</url>
    <picture>https://site.ru/img/1.jpg</picture>
    <picture>https://site.ru/img/2.jpg</picture>
    <name>Мужские духи</name>
    <description>Подчеркните свой стиль</description>
  </collection>
</collections>`}
          </pre>
          <p className="m-0 mt-1.5">
            Обязательно: атрибут <code className="font-mono">id</code>, <code className="font-mono">{"<url>"}</code>,{" "}
            <code className="font-mono">{"<name>"}</code>. <code className="font-mono">{"<picture>"}</code> можно несколько (первая —{" "}
            <code className="font-mono">{"{{ collection.image_url }}"}</code>, все — <code className="font-mono">{"{{ collection.images }}"}</code>).{" "}
            <code className="font-mono">{"<description>"}</code> необязательно. Товар ссылается на коллекцию (можно сразу на несколько) тегом{" "}
            <code className="font-mono">{"<collectionId>"}</code> внутри <code className="font-mono">{"<offer>"}</code> — попадает в{" "}
            <code className="font-mono">{"{{ product.collections }}"}</code>, тем же способом, что и категории (п.3). Резолв по id — см. п.7 в
            «Как работать с контекстом».
          </p>
        </section>

        <section>
          <div className="font-semibold text-ink mb-1">5. Что происходит после подключения</div>
          <p className="m-0">
            Ссылка сохраняется, товары/категории/коллекции кешируются в базе (кнопка «Обновить сейчас» — сразу, иначе автоматически каждые
            15 минут; полный перебор офферов пропускается, если атрибут <code className="font-mono">date</code> у{" "}
            <code className="font-mono">{"<yml_catalog>"}</code> не изменился с прошлой проверки — категории/коллекции при этом всё равно
            обновляются каждый раз, они лёгкие). Дальше товар/категория/коллекция доступны в Liquid по <code className="font-mono">id</code> —
            из трекинга события или ручного контекста шаблона/рассылки.
          </p>
        </section>
      </div>
    </Modal>
  );
}
