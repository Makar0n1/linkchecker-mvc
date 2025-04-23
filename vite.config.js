import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.', // Корень — текущая папка (где index.html)
  base: '/', // Базовый путь для продакшена (корень домена)
  css: {
    postcss: './postcss.config.js' // Оставляем PostCSS конфиг
  },
  server: {
    port: 3001, // Порт для dev-сервера
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // Проксируем запросы к бэкенду
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  build: {
    outDir: 'dist', // Папка для сборки (ты указал dist)
    sourcemap: false // Отключаем sourcemap для продакшена
  }
});