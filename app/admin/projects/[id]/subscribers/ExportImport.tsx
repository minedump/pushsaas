"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconDownload, IconUpload } from "@tabler/icons-react";
import { Button, Label, Modal, Select, useDialogs } from "@/app/ui";

// Minimal CSV parser: handles quoted fields with commas/semicolons/newlines/escaped quotes.
function parseCsv(rawText: string): { headers: string[]; rows: Record<string, string>[] } {
  // Срезаем BOM, если он есть — наш собственный экспорт добавляет его
  // намеренно (см. /api/admin/subscribers/export), чтобы Excel не превращал
  // кириллицу в кракозябры; без среза первый заголовок читался бы как "﻿id".
  let text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  // "sep=,\n" — служебная строка, которую раньше добавлял наш же экспорт
  // (сейчас вместо неё используется ";" — родной разделитель локали, см.
  // ниже — но у мерчанта может лежать файл, скачанный до этого перехода).
  // Не часть данных — срезаем перед разбором так же, как BOM.
  if (/^sep=.\r?\n/i.test(text)) text = text.slice(text.indexOf("\n") + 1);
  // Разделитель определяем по первой строке — наш экспорт теперь использует
  // ";" (родной разделитель для русской локали Excel/Таблиц), но старые
  // файлы или файл, набранный вручную, вполне могут быть на ",".
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((v) => v !== "")) rows.push(cur);
      cur = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  const [headers, ...body] = rows;
  return {
    headers: headers || [],
    rows: body.map((r) => Object.fromEntries((headers || []).map((h, i) => [h, r[i] ?? ""]))),
  };
}

export default function ExportImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useDialogs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [keyColumn, setKeyColumn] = useState("");
  const [matchAgainst, setMatchAgainst] = useState<"phone" | "email" | "insales_client_id">("phone");
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setKeyColumn(parsed.headers.find((h) => h.toLowerCase().includes("phone")) || parsed.headers[0] || "");
    setOpen(true);
  }

  async function runImport() {
    if (!keyColumn || !rows.length) return;
    setBusy(true);
    const res = await fetch("/api/admin/subscribers/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, keyColumn, matchAgainst, rows }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(json.error || "Ошибка импорта", "bad");
      return;
    }
    toast(`Обогащено ${json.matched}, не найдено ${json.unmatched}`, "good");
    setOpen(false);
    setHeaders([]);
    setRows([]);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => (window.location.href = `/api/admin/subscribers/export?projectId=${projectId}`)}>
        <IconDownload size={16} stroke={2} />
        Экспорт
      </Button>
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>
        <IconUpload size={16} stroke={2} />
        Импорт
      </Button>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFile} />

      {open && (
        <Modal onClose={() => setOpen(false)} className="max-w-md">
          <h3 className="text-base font-semibold m-0">Импорт: {rows.length} строк</h3>

          <div className="flex gap-3 mt-3">
            <div className="flex-1">
              <Label>Столбец-ключ в файле</Label>
              <Select value={keyColumn} onChange={(e) => setKeyColumn(e.target.value)} className="w-full">
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1">
              <Label>Сопоставлять с</Label>
              <Select value={matchAgainst} onChange={(e) => setMatchAgainst(e.target.value as typeof matchAgainst)} className="w-full">
                <option value="phone">Телефон подписчика</option>
                <option value="email">Email подписчика</option>
                <option value="insales_client_id">Внешний ID</option>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button size="sm" disabled={busy} onClick={runImport}>
              {busy ? "Импортируем…" : "Импортировать"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
