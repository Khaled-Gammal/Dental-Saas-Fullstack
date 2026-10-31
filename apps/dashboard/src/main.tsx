import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './queryClient';
import { AppErrorBoundary, initSentry } from './monitoring/sentry';
// self-hosted font (no request to Google): only the weights the design uses
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@dental/ui/tokens.css';
import './theme.css'; // the dashboard's healthcare palette over the shared tokens (the clinic websites keep theirs)
import './styles.css';
import './shadcn.css'; // Tailwind utilities + theme for the shadcn/ui components (no preflight)

initSentry(); // Phase 1B: off without VITE_SENTRY_DSN

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
