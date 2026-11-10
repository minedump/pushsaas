import { Card } from "@/app/ui";

// Проект заблокирован вручную (суперадмином). Единственная страница, доступная
// владельцу заблокированного проекта: guards.ts отправляет сюда со всех остальных.
export default function BlockedPage() {
  return (
    <main className="max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold">Проект заблокирован</h1>
      <Card className="mt-4 text-ink-muted">
        Работа проекта приостановлена: рассылки и сбор данных не выполняются. Чтобы вернуть доступ, свяжитесь с поддержкой.
      </Card>
    </main>
  );
}
