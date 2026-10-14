import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// envDir points at the repo root so the dashboard reads the shared .env (only VITE_* vars reach the browser)
export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  server: { port: 5173, strictPort: true },
});
