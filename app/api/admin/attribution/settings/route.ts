import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { friendlyError } from "@/lib/errors";

// Пути к полям заказа (number/total_price/items_price/financial_status) —
// захардкожены в /api/v1/attribute, подтверждены реальным заказом InSales
// (создание + смена статуса на оплачен). Настраивать нечего — только имя
// куки и окно атрибуции. Флага "включено" нет — вебхук всегда живой по
// своему токену (см. lib/attribution.ts).
export async function POST(req: Request) {
  const { projectId, cookieName, windowDays, clientSmsField, clientFieldMap } = await req.json().catch(() => ({}));
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const admin = createAdminClient();
  // Две независимые формы шлют сюда свои поля: атрибуция (кука и окно) и
  // вебхук клиентов (поле согласия на SMS). Обновляем только то, что прислали.
  const patch: Record<string, unknown> = {};
  if (cookieName !== undefined || windowDays !== undefined) {
    patch.attribution_cookie_name = cookieName || "pss_attr";
    patch.attribution_window_days = Number(windowDays) || 7;
    patch.attribution_order_id_path = "number";
    patch.attribution_revenue_path = "total_price";
  }
  if (clientSmsField !== undefined) patch.client_sms_field = String(clientSmsField).trim().slice(0, 80) || null;
  if (clientFieldMap !== undefined) {
    // [{handle, key}]: handle поля в магазине → доп. поле контакта. Ключ нормализуем
    // (пробелы в «_», нижний регистр) и не даём занять поля самого контакта.
    const RESERVED = new Set(["name", "phone", "email", "tags", "insales_client_id", "id", "created_at"]);
    const out: { handle: string; key: string }[] = [];
    const seen = new Set<string>();
    for (const row of Array.isArray(clientFieldMap) ? clientFieldMap.slice(0, 50) : []) {
      const handle = String(row?.handle ?? "").trim().slice(0, 80);
      const key = String(row?.key ?? "").trim().toLowerCase().replace(/s+/g, "_");
      if (!handle && !key) continue;
      if (!handle || !key) return NextResponse.json({ error: "Заполните обе части: поле в магазине и поле у нас" }, { status: 400 });
      if (!/^[p{L}p{N}_]{1,40}$/u.test(key)) return NextResponse.json({ error: `Название поля «${key}»: только буквы, цифры и «_», до 40 символов` }, { status: 400 });
      if (RESERVED.has(key)) return NextResponse.json({ error: `Поле «${key}» занято самим контактом, выберите другое название` }, { status: 400 });
      if (seen.has(handle.toLowerCase())) return NextResponse.json({ error: `Поле магазина «${handle}» указано дважды` }, { status: 400 });
      seen.add(handle.toLowerCase());
      out.push({ handle, key });
    }
    patch.client_field_map = out;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });
  const { error } = await admin.from("projects").update(patch).eq("id", projectId);

  if (error) return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
