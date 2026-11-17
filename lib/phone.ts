// Нормализация телефона к цифрам E.164 (без '+'): "+7 (925) 476-15-88" -> "79254761588".
// Российские номера: 8XXXXXXXXXX -> 7XXXXXXXXXX.
export function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 10 && digits.startsWith("9")) return "7" + digits; // РФ без кода страны
  return digits;
}

// SMS (Bytehand) и Telegram Gateway тарифицируются за попытку и рассчитаны
// на этот регион — код на случайный зарубежный номер это слив баланса без
// реального шанса на доставку. Push и email этим не ограничены (push не
// привязан к телефонии, email одинаково дёшев куда угодно).
const RU_CIS_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ["7", 11], // Россия, Казахстан
  ["375", 12], // Беларусь
  ["374", 11], // Армения
  ["994", 12], // Азербайджан
  ["996", 12], // Киргизия
  ["992", 12], // Таджикистан
  ["993", 11], // Туркменистан
  ["998", 12], // Узбекистан
  ["373", 11], // Молдова
];

export function isRuCisPhone(digits: string): boolean {
  return RU_CIS_PREFIXES.some(([prefix, len]) => digits.length === len && digits.startsWith(prefix));
}

// Для поиска по списку контактов: из любого написания ("+7 919 616-29-06", "8 (919) 616-29-06",
// "89196162906", "9196162906" или его начала) получаем цифры в том виде, в каком телефон лежит
// в базе (с 7 в начале). Не телефон (есть буквы, @) или меньше 3 цифр — null.
export function phoneSearchDigits(query: string): string | null {
  const q = (query || "").trim();
  if (!q || !/^[+\d\s().-]+$/.test(q)) return null;
  const digits = q.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits.length >= 4 && digits.startsWith("8") ? "7" + digits.slice(1) : digits;
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
  // Россия и Казахстан: +7 925 ***-**-81 (код страны одна цифра, затем три цифры оператора)
  if (digits.length === 11 && digits.startsWith("7")) return `+7 ${digits.slice(1, 4)} ***-**-${digits.slice(-2)}`;
  // остальные страны: код страны не фиксированной длины, показываем как раньше
  return `+${digits.slice(0, digits.length - 9)} ${digits.slice(-9, -6)} ***-**-${digits.slice(-2)}`;
}
