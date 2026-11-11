import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProjectAccessible } from "@/lib/guards";
import { eventLabel } from "@/lib/siteEventLabels";
import DeviceCard from "./DeviceCard";

// Карточка устройства без контакта (анонимный подписчик): открывается из списка «Подписчики».
// Если устройство уже привязано к контакту, открываем карточку контакта.
export default async function DevicePage({ params }: { params: Promise<{ id: string; subscriberId: string }> }) {
  const { id, subscriberId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, is_active").eq("id", id).maybeSingle();
  if (!project) notFound();
  await ensureProjectAccessible(project.id, project.is_active);

  const { data: device } = await supabase
    .from("subscribers")
    .select("id, platform, is_active, paused, created_at, attributes, endpoint, timezone")
    .eq("id", subscriberId)
    .eq("project_id", id)
    .maybeSingle();
  if (!device) notFound();

  const { data: link } = await supabase.from("identity_devices").select("identity_id").eq("subscriber_id", subscriberId).limit(1).maybeSingle();
  if (link?.identity_id) redirect(`/admin/projects/${id}/subscribers/${link.identity_id}`);

  const { data: rawEvents } = await supabase
    .from("events")
    .select("id, name, payload, created_at")
    .eq("project_id", id)
    .eq("subscriber_id", subscriberId)
    .order("created_at", { ascending: false })
    .limit(50);

  const events = (rawEvents ?? []).map((e) => {
    const payload = (e.payload || {}) as Record<string, unknown>;
    const detail = Object.entries(payload)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");
    return { id: String(e.id), label: eventLabel(e.name), detail, created_at: e.created_at as string };
  });

  const attrs = (device.attributes as Record<string, unknown> | null) ?? {};
  return (
    <DeviceCard
      projectId={id}
      device={{
        id: device.id,
        platform: device.platform,
        isActive: device.is_active,
        paused: !!device.paused,
        noPush: !device.endpoint,
        createdAt: device.created_at,
        timezone: device.timezone ?? "",
        name: typeof attrs.name === "string" ? attrs.name : "",
        ymClientId: typeof attrs.ym_client_id === "string" ? attrs.ym_client_id : "",
      }}
      events={events}
    />
  );
}
