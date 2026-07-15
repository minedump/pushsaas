# OIDC тестовый стенд

Минимальный OpenID Connect провайдер (Vercel serverless, без БД) для проверки
авторизации покупателя InSales с телефоном в claims.

Что проверяем:

1. Примет ли InSales ID Token **без email** — только `phone_number` (вариант A на странице входа).
2. Пользовательский флоу: кнопка в магазине → наша страница → телефон + код → возврат в магазин залогиненным.

## Устройство

- `api/discovery.js` → `/.well-known/openid-configuration`
- `api/jwks.js` → `/.well-known/jwks.json` (публичный RSA-ключ)
- `api/auth.js` → `/auth` — страница входа: телефон, тестовый код (показан на странице), выбор варианта claims (A: только телефон, B: + синтетический email, C: + настоящий email, D: только email)
- `api/token.js` → `/token` — обмен authorization code на ID Token (RS256, kid `stand-key-1`)
- Authorization code — короткоживущий HS256 JWT, поэтому БД не нужна
- Issuer выводится из хоста запроса — работает на любом vercel-домене

## Деплой

```
npm install
npm run gen-keys                       # keys/private.pem (в .gitignore)
vercel --yes                           # создать проект
vercel env add OIDC_PRIVATE_KEY_PEM production < keys/private.pem
vercel env add STAND_CLIENT_SECRET production   # любой случайный секрет
vercel --prod --yes
```

## Подключение к InSales (yuliawave.com)

Админка → Настройки → Авторизация покупателя → «Авторизация через OpenID Connect» → добавить приложение:

- **ID приложения:** `pushsaas-stand`
- **API token приложения:** значение `STAND_CLIENT_SECRET`
- **Issuer:** продакшн-домен деплоя (`https://…vercel.app`)

Затем на странице входа магазина появится кнопка → она ведёт на `/auth` стенда.

## Отладка

`vercel logs <deployment-url>` — все запросы InSales логируются с префиксом `[stand:…]`.
