// Единый формат «Имя (email)» + дата для мест, где автор/дата показываются
// одной строкой (форма редактирования шаблона, попап просмотра файла) —
// держим в одном месте, чтобы оба места не разъезжались при правках.
export function formatAuthor(name: string | null, email: string | null): string {
  if (!name && !email) return "—";
  if (!name) return email!;
  return email ? `${name} (${email})` : name;
}

export function formatShortDate(d: string): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
