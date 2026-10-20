import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './queryClient';
// self-hosted font (no request to Google): only the weights the design uses
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@dental/ui/tokens.css';
import './theme.css'; // the dashboard's healthcare palette over the shared tokens (the clinic websites keep theirs)
import './styles.css';
import './shadcn.css'; // Tailwind utilities + theme for the shadcn/ui components (no preflight)


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
