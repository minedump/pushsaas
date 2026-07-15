import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateVapidKeys } from "@/lib/webpush";

// Creates a project for the current user + its own VAPID key pair.
// Uses the service-role client so it can also write the private key into
// project_secrets (which RLS hides from clients). Ownership is set explicitly.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const admin = createAdminClient();

  // superadmin must not own projects — they manage clients, not create for themselves
  const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role === "admin") {
    return NextResponse.json({ error: "Суперадмин не может создавать проекты на себя" }, { status: 403 });
  }

  const { name, domain } = await req.json().catch(() => ({}));
  if (!name?.trim()) return NextResponse.json({ error: "Укажите название" }, { status: 400 });

  // normalise domain: strip protocol / path / trailing slash
  const cleanDomain = (domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase() || null;

  const vapid = generateVapidKeys();

  const { data: project, error } = await admin
    .from("projects")
    .insert({
      owner_id: user.id,
      name: name.trim(),
      domain: cleanDomain,
      vapid_public_key: vapid.publicKey,
    })
    .select("id")
    .single();

  if (error || !project) {
    return NextResponse.json({ error: error?.message || "Не удалось создать проект" }, { status: 500 });
  }

  const { error: secretErr } = await admin
    .from("project_secrets")
    .insert({ project_id: project.id, vapid_private_key: vapid.privateKey });

  if (secretErr) {
    // roll back the project so we never leave one without its private key
    await admin.from("projects").delete().eq("id", project.id);
    return NextResponse.json({ error: secretErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: project.id });
}
