import { IconBellOff } from "@tabler/icons-react";
import { ButtonLink } from "@/app/ui";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-6">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-6 grid place-items-center w-16 h-16 rounded-2xl bg-accent-tint">
          <IconBellOff size={28} stroke={1.6} className="text-accent" />
        </div>
        <div className="text-6xl font-bold text-ink tracking-tight">404</div>
        <h1 className="text-lg font-semibold text-ink mt-3 mb-1">Страница не найдена</h1>
        <p className="text-[13.5px] text-ink-muted mb-6">
          Такого адреса не существует или он был перемещён — возможно, устаревшая ссылка.
        </p>
        <ButtonLink href="/admin">На главную</ButtonLink>
      </div>
    </div>
  );
}
