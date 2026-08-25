import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { clearIdentityHistory } from "@/lib/identity";

export async function POST(req: Request, { params }: { params: Promise<{ identityId: string }> }) {
  const { identityId } = await params;
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const result = await clearIdentityHistory(projectId, identityId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
