import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { auditAs } from "@/lib/auditContext";
import { deleteContact } from "@/lib/identity";
import { writeAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request, { params }: { params: Promise<{ identityId: string }> }) {
  const { identityId } = await params;
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (access.user) auditAs(access.user.id);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const { data: before } = await createAdminClient()
    .from("identities")
    .select("name, phone, email")
    .eq("id", identityId)
    .eq("project_id", projectId)
    .maybeSingle();
  const result = await deleteContact(projectId, identityId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await writeAudit({
    projectId,
    entity: "subscriber",
    entityId: identityId,
    name: before?.name || before?.phone || before?.email || null,
    action: "delete",
  });
  return NextResponse.json({ ok: true });
}
