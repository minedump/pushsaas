import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { clearSiteEvents } from "@/lib/identity";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ identityId: string }> }) {
  const { identityId } = await params;
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const result = await clearSiteEvents(projectId, identityId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await writeAudit({ projectId, entity: "subscriber", entityId: identityId, action: "clear_events" });
  return NextResponse.json({ ok: true });
}
