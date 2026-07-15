import { verifyParam } from "@/lib/oidc";
import { issueCodeAndRedirect } from "@/lib/oidc-flow";

// Возврат после отскока привязки устройства: виджет магазина вызвал
// /api/public/link и вернул браузер сюда. Подпись sid выдаёт link-роут.
export async function GET(req: Request, _ctx: { params: Promise<{ projectId: string }> }) {
  const q = new URL(req.url).searchParams;
  const sid = q.get("sid") || "";
  const sig = q.get("sig") || "";
  if (!sid || !sig || !verifyParam(sid, sig)) {
    return new Response("bad signature", { status: 400 });
  }
  return issueCodeAndRedirect(sid);
}
