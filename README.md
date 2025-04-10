# LinkChecker Pro

![License](https://img.shields.io/badge/license-MIT-blue.svg)  
*Your ultimate tool for backlink analysis, built with passion and precision.*

**LinkChecker Pro** — это мощное веб-приложение для анализа обратных ссылок, созданное для SEO-специалистов и вебмастеров. Оно позволяет проверять ссылки на заданные домены, определять их статус (активные, сломанные, заблокированные), тип (dofollow/nofollow), индексацию и канонические URL. С поддержкой до 5 пользователей, интеграцией с Google Sheets и удобным интерфейсом для десктопа и мобильных устройств, LinkChecker Pro помогает автоматизировать рутинные задачи и улучшать SEO.

---

## Основные возможности
- **Многопользовательская поддержка**: До 5 пользователей с независимыми списками ссылок.
- **Проверка ссылок**: Анализ статуса, кода ответа, индексации, атрибутов (dofollow/nofollow) и канонических URL.
- **Интеграция с Google Sheets**: Автоматический анализ больших списков ссылок с настраиваемым интервалом (4-24 часа).
- **Обход CAPTCHA**: Интеграция с 2Captcha для решения hCaptcha, reCAPTCHA и других.
- **Хранение данных**: Ссылки сохраняются в MongoDB с привязкой к пользователю.
- **Адаптивный интерфейс**: Удобный дизайн для десктопа (сайдбар с минимизацией) и мобильных (навигация под хедером).

---

## Технологии
- **Frontend**: React, React Router, Tailwind CSS (локально через PostCSS), Vite  
- **Backend**: Node.js, Express, MongoDB, Mongoose  
- **Парсинг**: Puppeteer, Cheerio  
- **Аутентификация**: JWT, bcryptjs  
- **CAPTCHA**: 2Captcha  

---

## Установка
1. **Склонируй репозиторий**:
   ```bash
   git clone https://github.com/Makar0n1/linkchecker.git
   cd linkchecker
   ```

2. **Установи зависимости**:
   ```bash
   npm install
   ```

3. **Настрой MongoDB**:
   - Установи MongoDB локально или используй облачный сервис (например, MongoDB Atlas).
   - Запусти MongoDB:
     ```bash
     mongod
     ```

4. **Создай файл `.env`** в корне проекта для разработки:
   ```
   BACKEND_PORT=3000
   MONGODB_URI=mongodb://localhost:27017/linkchecker
   TWOCAPTCHA_API_KEY=your-2captcha-api-key
   FRONTEND_DOMAIN=localhost
   FRONTEND_PORT=3001
   VITE_FRONTEND_DOMAIN=localhost
   VITE_BACKEND_DOMAIN=localhost
   VITE_BACKEND_PORT=3000
   JWT_SECRET=your-super-secret-key-12345
   ```
   - Замени `your-2captcha-api-key` на свой ключ от 2Captcha.
   - Используй уникальный `JWT_SECRET` (например, строка вроде `my-secret-123`).

5. **Для продакшена создай `.env.prod`** (опционально):
   - Скопируй `.env` и адаптируй под продакшен (например, измените домены и порты).

---

## Запуск
### Локальная разработка
1. Запусти бэкенд и фронтенд одновременно:
   ```bash
   npm run dev
   ```
   - Бэкенд: `http://localhost:3000`
   - Фронтенд: `http://localhost:3001`

### Продакшен
1. Собери фронтенд:
   ```bash
   npm run build
   ```
2. Запусти продакшен:
   ```bash
   npm run prod
   ```
   - Фронтенд будет обслуживаться из `dist` на `http://localhost:3001`.
   - Бэкенд останется на `http://localhost:3000`.

### Предпросмотр сборки
```bash
npm run preview
```
- Проверяй собранный фронт на `http://localhost:4173`.

---

## Создание пользователей
Добавь пользователей через терминал:

### Bash (Linux/Mac)
```bash
curl -X POST http://localhost:3000/api/links/register -H "Content-Type: application/json" -d '{"username": "user1", "password": "password"}'
curl -X POST http://localhost:3000/api/links/register -H "Content-Type: application/json" -d '{"username": "user2", "password": "password"}'
curl -X POST http://localhost:3000/api/links/register -H "Content-Type: application/json" -d '{"username": "user3", "password": "password"}'
curl -X POST http://localhost:3000/api/links/register -H "Content-Type: application/json" -d '{"username": "user4", "password": "password"}'
curl -X POST http://localhost:3000/api/links/register -H "Content-Type: application/json" -d '{"username": "user5", "password": "password"}'
curl -X POST http://localhost:3000/api/links/register -H "Content-Type: application/json" -d '{"username": "SuperAdmin", "password": "adminpassword", "isSuperAdmin": true}'
```

### PowerShell (Windows)
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/links/register" -Method POST -Headers @{"Content-Type" = "application/json"} -Body '{"username": "user1", "password": "password"}'
Invoke-WebRequest -Uri "http://localhost:3000/api/links/register" -Method POST -Headers @{"Content-Type" = "application/json"} -Body '{"username": "user2", "password": "password"}'
Invoke-WebRequest -Uri "http://localhost:3000/api/links/register" -Method POST -Headers @{"Content-Type" = "application/json"} -Body '{"username": "user3", "password": "password"}'
Invoke-WebRequest -Uri "http://localhost:3000/api/links/register" -Method POST -Headers @{"Content-Type" = "application/json"} -Body '{"username": "user4", "password": "password"}'
Invoke-WebRequest -Uri "http://localhost:3000/api/links/register" -Method POST -Headers @{"Content-Type" = "application/json"} -Body '{"username": "user5", "password": "password"}'
Invoke-WebRequest -Uri "http://localhost:3000/api/links/register" -Method POST -Headers @{"Content-Type" = "application/json"} -Body '{"username": "SuperAdmin", "password": "adminpassword", "isSuperAdmin": true}'
```

---

## Использование
1. **Запусти приложение**:
   - Открой `http://localhost:3001` в браузере.
   - Увидишь главную страницу с описанием и кнопкой "Login" (или "Start Analyse", если уже авторизован).

2. **Вход**:
   - Нажми "Login", введи логин и пароль (например, `user1` / `password` или `SuperAdmin` / `adminpassword`).
   - После входа попадёшь в дашборд.

3. **Дашборд**:
   - **Десктоп**: Сайдбар слева с вкладками "Manual Links" (для всех) и "Google Sheets" (для SuperAdmin). Сайдбар можно минимизировать до иконок.
   - **Мобильный**: Навигация под хедером с горизонтальным скроллом: "Manual Links", "Google Sheets" (для SuperAdmin), "Logout".

4. **Manual Links**:
   - Добавь ссылки вручную: введи URL (по одному на строку) и целевой домен (Target Domain).
   - Нажми "Add Links", чтобы сохранить.
   - Нажми "Check All Links", чтобы проанализировать: получишь статус (OK/Problem), код ответа, индексацию, атрибуты (dofollow/nofollow), канонический URL.
   - Если каноникал не совпадает с анализируемым URL, это подсвечивается жёлтым с подсказкой.
   - Удаляй ссылки по одной или все сразу ("Delete All Links").

5. **Google Sheets** (для SuperAdmin):
   - Добавь Google Sheet: укажи Spreadsheet ID, GID, Target Domain, колонки для URL и целевых ссылок, диапазон для результатов, интервал проверки (4-24 часа).
   - Нажми "Add Spreadsheet", затем "Run" для анализа.
   - Статусы: серый (неактивно), синий (анализ идёт), зелёный (завершён), красный (ошибка).

6. **Выход**:
   - Нажми "Logout" в навигации, чтобы выйти из аккаунта.

---

## Структура проекта
```
linkchecker/
├── src/
│   ├── backend/              # Server-side logic (Express, MongoDB)
│   │   ├── controllers/      # API controllers (e.g., linkController.js)
│   │   ├── models/           # Mongoose models (e.g., User, Link)
│   │   ├── routes/           # API routes (e.g., linkRoutes.js)
│   │   └── server.js         # Express server configuration
│   ├── frontend/             # React frontend (Vite, Tailwind)
│   │   ├── components/       # React components (e.g., StartPage, LoginPage)
│   │   ├── styles.css        # Tailwind CSS entry point
│   │   └── main.jsx          # React app entry point
│   └── index.js              # Entry point for launching backend and frontend
├── index.html                # Main HTML file for the frontend
├── vite.config.js            # Vite configuration with PostCSS integration
├── tailwind.config.js        # Tailwind CSS configuration
├── postcss.config.js         # PostCSS setup for Tailwind and autoprefixer
├── .env                      # Development environment variables
├── .env.prod                 # Production environment variables
├── .gitignore                # Git ignore rules (e.g., node_modules, dist)
├── package.json              # Project dependencies and scripts
├── dist/                     # Compiled frontend assets (generated by npm run build)
└── public/                   # Source files (e.g. images, icons, fonts)
```

---

## Автор
- **Кирилл Штепа**  
- GitHub: [github.com/Makar0n1](https://github.com/Makar0n1)  
- *Всем хорошего дня и продуктивной работы с LinkChecker Pro!* 😊

---

## Лицензия
MIT License — используй как хочешь, только упомяни автора!