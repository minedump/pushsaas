import UnsubscribeConfirm from "./UnsubscribeConfirm";

// Публичная страница — без авторизации, доступна кому угодно по ссылке из
// письма (?p=projectId&e=email&t=token, см. lib/unsubscribe.ts). Само
// отписывание — отдельный POST после явного клика (см. UnsubscribeConfirm),
// не на этот GET: почтовые сканеры автоматически переходят по ссылкам
// внутри писем, голая отписка на GET сработала бы без участия получателя.
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; e?: string; t?: string; pss_c?: string; pss_r?: string }>;
}) {
  const { p, e, t, pss_c, pss_r } = await searchParams;
  if (!p || !e || !t) {
    return (
      <main className="max-w-md mx-auto mt-24 text-center px-4">
        <h1 className="text-xl font-semibold text-ink">Ссылка недействительна</h1>
        <p className="text-ink-muted mt-2">Не хватает данных для отписки — проверьте, что ссылка скопирована полностью.</p>
      </main>
    );
  }
  // pss_c/pss_r — те же параметры, что кликнет/трекинг открытий (см.
  // injectClickTracking в lib/sender.ts — дописывает их на КАЖДУЮ ссылку в
  // письме, включая эту) — необязательны: отписка сама по себе работает и
  // без них (например, если письмо переслали и ссылку скопировали руками),
  // просто тогда не привязывается к конкретной кампании в статистике.
  return <UnsubscribeConfirm projectId={p} email={e} token={t} campaignId={pss_c} recipientToken={pss_r} />;
}
