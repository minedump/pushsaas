import { NextResponse } from "next/server";
import { assertProjectAccess } from "@/lib/auth";
import { updateContact } from "@/lib/identity";

export async function POST(req: Request, { params }: { params: Promise<{ identityId: string }> }) {
  const { identityId } = await params;
  const body = await req.json().catch(() => ({}));
  const { projectId, phone, email, name, insalesClientId, smsActive, emailActive, tags, attributes } = body as {
    projectId?: string;
    phone?: string;
    email?: string;
    name?: string;
    insalesClientId?: string;
    smsActive?: boolean;
    emailActive?: boolean;
    tags?: string[];
    attributes?: Record<string, string | null>;
  };
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await assertProjectAccess(projectId);
  if (!access.ok) return NextResponse.json({ error: "Нет доступа" }, { status: access.status });

  const result = await updateContact(projectId, identityId, {
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    name: name !== undefined ? name : undefined,
    insalesClientId: insalesClientId !== undefined ? insalesClientId : undefined,
    smsActive: phone?.trim() ? !!smsActive : undefined,
    emailActive: email?.trim() ? !!emailActive : undefined,
    tags: Array.isArray(tags) ? tags : undefined,
    attributes: attributes && typeof attributes === "object" ? attributes : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
