import { QueryClient } from '@tanstack/react-query';

/**
 * Review R10: a refusal or a missing record (4xx) is the answer, not a glitch, so it is not asked again; a network or
 * server error is retried once. The status is read off the error itself (ApiError carries it) to keep this module free
 * of an import cycle with api.ts.
 */
const retry = (failures: number, error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return !(typeof status === 'number' && status >= 400 && status < 500) && failures < 1;
};

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry, staleTime: 30_000, refetchOnWindowFocus: false } },
});
