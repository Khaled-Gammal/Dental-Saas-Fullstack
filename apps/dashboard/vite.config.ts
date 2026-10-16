import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// envDir points at the repo root so the dashboard reads the shared .env (only VITE_* vars reach the browser)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } }, // shadcn/ui components import from "@/…"
  envDir: '../..',
  server: { port: 5173, strictPort: true },
});
