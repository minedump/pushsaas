// Правила пароля при регистрации и смене. Серверная часть (длина и наборы
// символов) задана в docker-compose.yml для GoTrue и не обходится прямым
// запросом к API; здесь те же правила плюс список слишком простых паролей,
// чтобы человек видел причину сразу, до отправки формы. GoTrue проверку
// «пароль есть в утечках» (HIBP) сделать не может: его сеть закрытая, без выхода
// в интернет.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_HINT = "Не короче 10 символов: строчная и заглавная буквы и цифра";

const LOWER = /[a-zа-яё]/;
const UPPER = /[A-ZА-ЯЁ]/;
const DIGIT = /[0-9]/;

// Корни самых частых паролей, латиницей и русской раскладкой.
const COMMON_ROOTS = [
  "password", "passw0rd", "qwerty", "qwertyuiop", "asdfgh", "zxcvbn", "123456", "12345678", "111111",
  "abc123", "admin", "letmein", "welcome", "iloveyou", "monkey", "dragon", "football", "sendera",
  "пароль", "йцукен", "фыва", "привет", "админ", "qazwsx", "1q2w3e", "1qaz2wsx",
];

export function checkPassword(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Пароль слишком короткий: нужно минимум ${PASSWORD_MIN_LENGTH} символов`;
  if (!LOWER.test(password)) return "Добавьте в пароль строчную букву";
  if (!UPPER.test(password)) return "Добавьте в пароль заглавную букву";
  if (!DIGIT.test(password)) return "Добавьте в пароль цифру";

  const plain = password.toLowerCase();
  if (COMMON_ROOTS.some((r) => plain.includes(r))) return "Пароль слишком простой: он входит в список самых частых";
  if (new Set(password).size < 5) return "Пароль слишком простой: слишком мало разных символов";

  const local = (email || "").split("@")[0].toLowerCase();
  if (local.length >= 4 && plain.includes(local)) return "Не используйте в пароле часть своего email";

  return null;
}
