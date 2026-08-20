import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 1x1 transparent GIF, base64.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7", "base64");

function pixelResponse() {
  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}

// Пиксель открытия письма — GET, встраивается в HTML маркетингового/
// транзакционного email (см. injectOpenPixel в lib/sender.ts). ВСЕГДА
// отвечает картинкой, что бы ни случилось на нашей стороне — почтовый клиент
// не должен видеть сломанную иконку из-за ошибки записи трекинга, а сам факт
// открытия — статистика, а не то, от чего зависит доставка письма.
// c — id кампании, t — персональный token (тот же, что у клик-трекинга,
// campaign_recipients.token). Первое открытие побеждает, как и у clicked_at.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const campaignId = url.searchParams.get("c");
    const token = url.searchParams.get("t");
    if (campaignId && token) {
      const admin = createAdminClient();
      const { data: updated } = await admin
        .from("campaign_recipients")
        .update({ opened_at: new Date().toISOString() })
        .eq("campaign_id", campaignId)
        .eq("token", token)
        .is("opened_at", null)
        .select("id");
      if (updated?.length) {
        await admin.rpc("increment_campaign_opened", { p_campaign_id: campaignId }).then(
          () => {},
          () => {}
        );
      }
    }
  } catch {
    // best-effort — картинка уходит в любом случае
  }
  return pixelResponse();
}
