import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWelcomeNow, resolveCascadeChannel } from "@/lib/sender";
import { consumeViewedProductIds, consumeViewedCategoryIds } from "@/lib/identity";

// Drains due automation jobs and sends their push. Protected by CRON_SECRET.
// Meant to be hit every minute by an external cron (cron-job.org) —
// Vercel Hobby crons run only daily.
//
// Throughput: drains in batches of 300, looping within the same invocation
// (bounded by iteration count + a time budget) so a backlog across many
// projects doesn't take multiple cron ticks to clear.
export const maxDuration = 60;

const BATCH = 300;
const MAX_ITERATIONS = 5;
const TIME_BUDGET_MS = 45_000;

// Best-effort: ids among `ids` whose subscriber row has paused=true. Returns
// an empty set (excludes nobody) if the column isn't migrated yet — this must
// NEVER be baked into the main select above, or a missing column there errors
// the whole join and silently stops every automation from firing.
async function pausedIdsAmong(admin: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await admin.from("subscribers").select("id").eq("paused", true).in("id", ids);
  if (error || !data?.length) return new Set();
  return new Set(data.map((r) => r.id));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("authorization")?.replace("Bearer ", "");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();
  let sent = 0;
  let skipped = 0;
  let totalDue = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    const { data: due } = await admin
      .from("automation_jobs")
      .select(
        "id, project_id, automation_id, subscriber_id, identity_id, payload, automations(type, channel, template_id, name, title, body, click_url, config, segment_tags, spacing_enabled, spacing_minutes, send_window_enabled, send_days, send_time_from, send_time_to, send_window_subscriber_tz, cascade, channel_templates, provider, platforms), subscribers(id, endpoint, p256dh, auth, is_active, attributes)"
      )
      .eq("status", "pending")
      .lte("fire_at", new Date().toISOString())
      .limit(BATCH);

    if (!due?.length) break;
    totalDue += due.length;

    const paused = await pausedIdsAmong(admin, due.filter((j) => j.subscriber_id).map((j) => j.subscriber_id as string));

    for (const job of due) {
      // claim the job so a concurrent run can't double-send
      const { data: claimed } = await admin
        .from("automation_jobs")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) {
        skipped++;
        continue;
      }

      const a = Array.isArray(job.automations) ? job.automations[0] : job.automations;

      // welcome (push/sms/email, template-based) — вся логика резолва
      // шаблона/провайдера/отправки/лога уже в sendWelcomeNow, тот же путь,
      // что и немедленная отправка (delay=0) в fireWelcomeAutomations.
      if (a?.type === "welcome") {
        const { data: project } = await admin.from("projects").select("welcome_channel_provider, timezone").eq("id", job.project_id).maybeSingle();

        let channel = a.channel as "push" | "sms" | "email" | null;
        let templateId = a.template_id as string | null;
        let identityId = job.identity_id || undefined;

        if (a.cascade) {
          // Задание каскадной карточки не знает заранее, каким каналом
          // уйдёт — резолвим прямо сейчас (приоритет мог смениться за время
          // задержки, это нормально, та же логика, что и у обычной проверки
          // respects_priority на момент отправки).
          if (!identityId && job.subscriber_id) {
            const { data: link } = await admin.from("identity_devices").select("identity_id").eq("subscriber_id", job.subscriber_id).limit(1).maybeSingle();
            identityId = link?.identity_id || undefined;
          }
          const resolved = await resolveCascadeChannel(admin, job.project_id, identityId, (a.channel_templates as Record<string, string> | null) || {});
          channel = resolved?.channel || null;
          templateId = resolved?.templateId || null;
        }

        const providerHint =
          channel && (channel === "sms" || channel === "email")
            ? a.provider || (project?.welcome_channel_provider as Record<string, string> | null)?.[channel] || null
            : null;
        const status = channel && templateId
          ? await sendWelcomeNow(
              admin,
              job.project_id,
              job.automation_id,
              channel,
              templateId,
              { subscriberId: job.subscriber_id || undefined, identityId },
              providerHint,
              a.name ?? null,
              a.spacing_enabled ? a.spacing_minutes ?? null : null,
              {
                enabled: !!a.send_window_enabled,
                days: (a.send_days as number[] | null) || null,
                timeFrom: a.send_time_from,
                timeTo: a.send_time_to,
                useSubscriberTz: !!a.send_window_subscriber_tz,
              },
              project?.timezone || "Europe/Moscow",
              "welcome",
              null,
              (a.platforms as string[] | null) || null
            )
          : "skipped";
        if (status === "sent") sent++;
        else skipped++;
        continue;
      }

      // event (брошенная корзина и т.п.) — теперь на том же уровне, что и
      // welcome: шаблон+любой канал+приоритет+сегмент+окно отправки+защита
      // от наложения, вся эта часть уже в sendWelcomeNow (единая точка). Не
      // хватало только здесь: события триггерятся ТОЛЬКО push-подпиской (см.
      // track() в embed-скрипте), поэтому identity для sms/email/сегмента/
      // приоритета резолвим с устройства сами — welcome для delay>0 успевает
      // это сделать заранее в fireWelcomeAutomations, у событий такого
      // препроцессора нет (ingest_event — чистый SQL, см. migration 0059).
      if (a?.type === "event") {
        let channel = (a.channel || "push") as "push" | "sms" | "email";
        let templateId = a.template_id as string | null;
        let status: "sent" | "failed" | "skipped" = "skipped";

        if ((a.cascade || a.template_id) && job.subscriber_id && !paused.has(job.subscriber_id)) {
          const { data: link } = await admin
            .from("identity_devices")
            .select("identity_id")
            .eq("subscriber_id", job.subscriber_id)
            .limit(1)
            .maybeSingle();
          const identityId = link?.identity_id || undefined;

          let allowed = true;
          const segTags = (a.segment_tags as string[] | null) || [];
          if (segTags.length) {
            if (!identityId) allowed = false;
            else {
              const { data: identity } = await admin.from("identities").select("tags").eq("id", identityId).maybeSingle();
              const tags = (identity?.tags as string[] | null) || [];
              allowed = segTags.some((t) => tags.includes(t));
            }
          }

          const { data: project } = await admin
            .from("projects")
            .select("welcome_channel_enabled, welcome_channel_provider, timezone")
            .eq("id", job.project_id)
            .maybeSingle();

          if (a.cascade) {
            // Победитель среди каналов, настроенных в самой карточке — канал
            // резолвится этой проверкой целиком (см. resolveCascadeChannel,
            // которая уже сама учитывает «Приоритет каналов» проекта).
            if (allowed) {
              const resolved = await resolveCascadeChannel(admin, job.project_id, identityId, (a.channel_templates as Record<string, string> | null) || {});
              channel = resolved?.channel || channel;
              templateId = resolved?.templateId || null;
              if (!resolved) allowed = false;
            }
          } else if ((project?.welcome_channel_enabled as Record<string, boolean> | null)?.[channel] === false) {
            allowed = false;
          }

          if (allowed && templateId && (channel === "push" || identityId)) {
            const providerHint =
              channel === "sms" || channel === "email"
                ? a.provider || (project?.welcome_channel_provider as Record<string, string> | null)?.[channel] || null
                : null;
            const recipient = channel === "push" ? { subscriberId: job.subscriber_id } : { identityId };

            // product_viewed/category_viewed всегда идут по накопительному
            // флоу — вместо одиночного id из этого конкретного срабатывания
            // подставляем ВЕСЬ накопленный с прошлой отправки список
            // просмотров (копится в ingest_event, см. migration 0068) и сразу
            // же чистим его тем же запросом (consumeViewed*) — следующий цикл
            // просмотров начинается с нуля. Ничего не накопилось (гонка/
            // первый показ до записи) — просто уходит как обычно, с
            // одиночным id из job.payload.
            let eventPayload = (job.payload as Record<string, unknown> | null) || {};
            const eventTrigger = (a.config as { trigger_event?: string } | null)?.trigger_event;
            if (identityId) {
              if (eventTrigger === "product_viewed") {
                const ids = await consumeViewedProductIds(identityId);
                if (ids.length) eventPayload = { ...eventPayload, product_ids: ids };
              } else if (eventTrigger === "category_viewed") {
                const ids = await consumeViewedCategoryIds(identityId);
                if (ids.length) eventPayload = { ...eventPayload, category_ids: ids };
              }
            }

            status = await sendWelcomeNow(
              admin,
              job.project_id,
              job.automation_id,
              channel,
              templateId,
              recipient,
              providerHint,
              a.name ?? null,
              a.spacing_enabled ? a.spacing_minutes ?? null : null,
              {
                enabled: !!a.send_window_enabled,
                days: (a.send_days as number[] | null) || null,
                timeFrom: a.send_time_from,
                timeTo: a.send_time_to,
                useSubscriberTz: !!a.send_window_subscriber_tz,
              },
              project?.timezone || "Europe/Moscow",
              "event",
              eventPayload,
              (a.platforms as string[] | null) || null
            );
          }
        }

        if (status === "sent") sent++;
        else skipped++;
        continue;
      }

      skipped++;
    }

    if (due.length < BATCH) break; // допили всё, что было готово
  }

  return NextResponse.json({ due: totalDue, sent, skipped });
}
