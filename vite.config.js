import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.', // Корень — текущая папка (где index.html)
  css: {
    postcss: './postcss.config.js' // Указываем PostCSS конфиг
  },
  server: {
    port: 3001 // Порт для dev-сервера
  }
});