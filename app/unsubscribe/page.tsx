import UnsubscribeConfirm from "./UnsubscribeConfirm";

// Публичная страница — без авторизации, доступна кому угодно по ссылке из
// письма (?p=projectId&e=email&t=token, см. lib/unsubscribe.ts). Само
// отписывание — отдельный POST после явного клика (см. UnsubscribeConfirm),
// не на этот GET: почтовые сканеры автоматически переходят по ссылкам
// внутри писем, голая отписка на GET сработала бы без участия получателя.
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ p?: string; e?: string; t?: string }> }) {
  const { p, e, t } = await searchParams;
  if (!p || !e || !t) {
    return (
      <main className="max-w-md mx-auto mt-24 text-center px-4">
        <h1 className="text-xl font-semibold text-ink">Ссылка недействительна</h1>
        <p className="text-ink-muted mt-2">Не хватает данных для отписки — проверьте, что ссылка скопирована полностью.</p>
      </main>
    );
  }
  return <UnsubscribeConfirm projectId={p} email={e} token={t} />;
}
