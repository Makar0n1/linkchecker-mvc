/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./index.html",
      "./src/frontend/**/*.{js,jsx,ts,tsx}" // Указываем пути к файлам фронта
    ],
    theme: {
      extend: {
        screens: {
          'custom-1300': '1300px', // Добавsляем брейкпоинт для 1300px
        },
      },
    },
    plugins: []
  };