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
  build: {
    chunkSizeWarningLimit: 700, // the vendor file above is ~600 kB (React + Radix); every screen file is far smaller
    rollupOptions: {
      output: {
        // redesign R5: React, Radix and TanStack change far less often than the app, so they get their own file that
        // browsers keep across deploys (the screens are split per page in App.tsx)
        manualChunks: (id) => (/node_modules[\/](react|react-dom|scheduler|@tanstack|radix-ui|@radix-ui|@floating-ui)[\/]/.test(id) ? 'vendor' : undefined),
      },
    },
  },
});
