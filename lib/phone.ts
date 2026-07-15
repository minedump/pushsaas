// Нормализация телефона к цифрам E.164 (без '+'): "+7 (925) 476-15-88" -> "79254761588".
// Российские номера: 8XXXXXXXXXX -> 7XXXXXXXXXX.
export function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 10 && digits.startsWith("9")) return "7" + digits; // РФ без кода страны
  return digits;
}

export function formatPhone(digits: string): string {
  if (digits.length === 11 && digits.startsWith("7")) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return "+" + digits;
}

// Для UI: "+7 925 ***-**-88"
export function maskPhone(digits: string): string {
  if (digits.length < 6) return "+" + digits;
  return `+${digits.slice(0, digits.length - 9)} ${digits.slice(-9, -6)} ***-**-${digits.slice(-2)}`;
}
