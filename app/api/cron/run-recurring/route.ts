import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fireRecurringAutomation } from "@/lib/sender";
import { computeNextFireAt, type RecurringSchedule } from "@/lib/recurring";

// Тикает «Повторяющиеся» автоматизации — вместо ежеминутной точности (как у
// run-automations/run-campaign-jobs, там нужен точный delay) раз в 5 минут
// достаточно: расписание всё равно в целых минутах, экономит вызовы крона.
// Защищено CRON_SECRET, тот же принцип, что и у остальных app/api/cron/*.
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  const { data: due } = await admin
    .from("automations")
    .select(
      "id, project_id, name, channel, template_id, cascade, channel_templates, provider, platforms, segment_tags, is_transactional, spacing_enabled, spacing_minutes, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, config, next_fire_at"
    )
    .eq("type", "recurring")
    .eq("is_enabled", true)
    .lte("next_fire_at", now.toISOString())
    .limit(100);

  const results: Record<string, string> = {};
  for (const a of due ?? []) {
    // клеймим (сдвигаем next_fire_at) ДО отправки — конкурентный тик не
    // должен запустить одну и ту же автоматизацию дважды, тот же принцип
    // атомарного claim, что и у остальных cron-обработчиков в проекте.
    const schedule = (a.config as { schedule?: RecurringSchedule } | null)?.schedule;
    if (!schedule) {
      results[a.id] = "no schedule configured";
      continue;
    }
    const { data: project } = await admin.from("projects").select("timezone").eq("id", a.project_id).maybeSingle();
    const tz = project?.timezone || "Europe/Moscow";
    const nextFireAt = computeNextFireAt(schedule, tz, now);

    // due-выборка выше уже требует next_fire_at <= now (NULL никогда не
    // проходит такое сравнение в Postgres), так что здесь оно гарантированно
    // не null — .eq на него безопасен как условие атомарного claim.
    const { data: claimed } = await admin
      .from("automations")
      .update({ next_fire_at: nextFireAt.toISOString(), last_fired_at: now.toISOString() })
      .eq("id", a.id)
      .eq("next_fire_at", a.next_fire_at as string)
      .select("id");
    if (!claimed?.length) {
      results[a.id] = "skipped (already claimed)";
      continue;
    }

    try {
      const r = await fireRecurringAutomation({
        id: a.id,
        project_id: a.project_id,
        name: a.name,
        channel: (a.channel || "push") as "push" | "sms" | "email",
        template_id: a.template_id,
        cascade: !!a.cascade,
        channel_templates: (a.channel_templates as Record<string, string> | null) || {},
        provider: a.provider,
        platforms: (a.platforms as string[] | null) || [],
        segment_tags: (a.segment_tags as string[] | null) || [],
        is_transactional: !!a.is_transactional,
        spacing_enabled: !!a.spacing_enabled,
        spacing_minutes: a.spacing_minutes,
        send_window_enabled: !!a.send_window_enabled,
        send_days: (a.send_days as number[] | null) || null,
        send_time_from: a.send_time_from,
        send_time_to: a.send_time_to,
        send_window_subscriber_tz: !!a.send_window_subscriber_tz,
      });
      results[a.id] = r.ok ? `ok (campaign=${r.campaignId ?? "-"}, enqueued=${r.enqueued ?? 0})` : r.error || "failed";
    } catch (e) {
      results[a.id] = e instanceof Error ? e.message : "error";
    }
  }

  return NextResponse.json({ due: due?.length ?? 0, results });
}
