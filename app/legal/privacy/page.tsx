import { Card } from "@/app/ui";

// Заглушка — реальный текст политики конфиденциальности сюда ещё не
// завезли (см. форму регистрации, app/login/page.tsx, которая на этот
// адрес и ссылается из чекбокса согласия). Страница уже настоящая, не
// href="#", чтобы ссылка из формы вела куда-то реальное уже сейчас.
export const metadata = { title: "Политика конфиденциальности — SENDERA" };

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-2xl mx-auto mt-16 px-5 mb-16">
      <h1 className="text-2xl font-semibold mb-5">Политика конфиденциальности</h1>
      <Card>
        <p className="text-ink-muted m-0">
          Текст политики конфиденциальности готовится и будет опубликован на этой странице. Ссылка уже рабочая —
          именно на неё ведёт форма регистрации.
        </p>
      </Card>
    </main>
  );
}
