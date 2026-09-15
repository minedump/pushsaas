import { Card } from "@/app/ui";

// Заглушка — см. app/legal/privacy/page.tsx, тот же принцип: рабочая
// ссылка из чекбокса согласия в форме регистрации, реальный текст согласия
// на обработку персональных данных ещё не завезли.
export const metadata = { title: "Согласие на обработку персональных данных — SENDERA" };

export default function PersonalDataConsentPage() {
  return (
    <main className="max-w-2xl mx-auto mt-16 px-5 mb-16">
      <h1 className="text-2xl font-semibold mb-5">Согласие на обработку персональных данных</h1>
      <Card>
        <p className="text-ink-muted m-0">
          Текст согласия на обработку персональных данных готовится и будет опубликован на этой странице. Ссылка
          уже рабочая — именно на неё ведёт форма регистрации.
        </p>
      </Card>
    </main>
  );
}
