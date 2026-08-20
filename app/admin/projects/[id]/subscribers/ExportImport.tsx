"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconDownload, IconUpload } from "@tabler/icons-react";
import { Button, Input, Label, Modal, Select, useDialogs } from "@/app/ui";

// Minimal CSV parser: handles quoted fields with commas/newlines/escaped quotes.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
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
    } else if (c === ",") {
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
  const [matchAgainst, setMatchAgainst] = useState("phone");
  const [customAttr, setCustomAttr] = useState("");
  const [activateChannel, setActivateChannel] = useState(false);
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
    const finalMatch = matchAgainst === "custom" ? customAttr.trim() : matchAgainst;
    if (!finalMatch) {
      toast("Укажите имя атрибута для сопоставления", "bad");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/subscribers/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        keyColumn,
        matchAgainst: finalMatch,
        rows,
        activateChannel: (matchAgainst === "phone" || matchAgainst === "email") && activateChannel,
      }),
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
    setActivateChannel(false);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => (window.location.href = `/api/admin/subscribers/export?projectId=${projectId}`)}>
        <IconDownload size={15} stroke={1.8} />
        Экспорт CSV
      </Button>
      <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
        <IconUpload size={15} stroke={1.8} />
        Импорт / обогащение
      </Button>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFile} />

      {open && (
        <Modal onClose={() => setOpen(false)} className="max-w-md">
          <h3 className="text-base font-semibold m-0">Импорт: {rows.length} строк</h3>
          <p className="text-sm text-ink-muted mt-2 mb-0">
            По какому столбцу искать подписчика, и с чем его сопоставлять. Остальные столбцы добавятся в его
            профиль (атрибуты) — доступны потом как <code className="font-mono">{"{ключ}"}</code> в текстах;
            столбец <code className="font-mono">insales_client_id</code> среди них — исключение, он уйдёт во
            внешний ID подписчика, а не в атрибуты.
          </p>

          <div className="mt-3">
            <Label>Столбец-ключ в файле</Label>
            <Select value={keyColumn} onChange={(e) => setKeyColumn(e.target.value)} className="w-full">
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </div>

          <div className="mt-3">
            <Label>Сопоставлять с</Label>
            <Select value={matchAgainst} onChange={(e) => setMatchAgainst(e.target.value)} className="w-full">
              <option value="phone">Телефон подписчика</option>
              <option value="email">Email подписчика</option>
              <option value="insales_client_id">Внешний ID (например, ID клиента в InSales)</option>
              <option value="custom">Свой атрибут…</option>
            </Select>
          </div>

          {matchAgainst === "custom" && (
            <div className="mt-3">
              <Label>Имя атрибута (как в attributes)</Label>
              <Input value={customAttr} onChange={(e) => setCustomAttr(e.target.value)} placeholder="например, loyalty_tier" />
            </div>
          )}

          {(matchAgainst === "phone" || matchAgainst === "email") && (
            <label className="flex items-start gap-2 mt-3.5 text-sm text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={activateChannel}
                onChange={(e) => setActivateChannel(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Отметить найденные контакты как согласных на{" "}
                {matchAgainst === "phone" ? "SMS-рассылку" : "Email-рассылку"} — включает канал для маркетинговых
                кампаний, а не только для входа по коду.
              </span>
            </label>
          )}

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
