import { API_URL } from './config';
import { queryClient } from './queryClient';

/** RFC 9457 error from the API. `code` is stable; `message` is shown to the user. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    detail: string,
    public errors?: { path: string; message: string }[],
    public body: Record<string, unknown> = {},
  ) {
    super(detail);
  }
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: { id: string; name: string; email: string | null; phone: string | null };
  clinic: { id: string; slug: string; nameAr: string | null; nameEn: string | null; role: string; status: string; permissions: string[] };
  clinics: { slug: string; nameAr: string | null; nameEn: string | null }[];
}

// The access token lives in memory only. The refresh token is an httpOnly cookie the browser
// sends to /auth/refresh; JavaScript can never read it, so an XSS bug cannot steal a session.
let accessToken: string | null = null;
let onSessionChange: (s: Session | null) => void = () => undefined;
export const subscribeSession = (fn: (s: Session | null) => void) => { onSessionChange = fn; };
let currentClinic: string | null = null;
export const setSession = (s: Session | null) => {
  accessToken = s?.accessToken ?? null;
  // a different user or clinic must never see the previous one's cached data
  const clinic = s ? `${s.user.id}:${s.clinic.id}` : null;
  if (clinic !== currentClinic) queryClient.clear();
  currentClinic = clinic;
  onSessionChange(s);
};

async function raw(path: string, init: RequestInit = {}, token = accessToken): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include', // send/receive the refresh cookie
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    // offline, DNS, CORS or the API is down: one typed error so screens can show a proper message
    throw new ApiError(0, 'network', 'Network error');
  }
}

async function toError(res: Response): Promise<ApiError> {
  const p = await res.json().catch(() => ({}));
  return new ApiError(res.status, p.code ?? 'error', p.detail ?? p.title ?? res.statusText, p.errors, p);
}

// one refresh at a time, even if several requests get 401 together
let refreshing: Promise<Session | null> | null = null;
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      let res = await raw('/auth/refresh', { method: 'POST' }, null).catch(() => null);
      if (!res) return null; // network down: keep the current session state, the next request will retry
      if (res.status === 401) {
        // another tab rotated the cookie a moment ago; the browser now holds the new one, so retry once
        const p = await res.clone().json().catch(() => ({}));
        if (p.code === 'refresh_race') {
          await new Promise((r) => setTimeout(r, 300));
          res = (await raw('/auth/refresh', { method: 'POST' }, null).catch(() => null)) ?? res;
        }
      }
      if (!res.ok) { setSession(null); return null; }
      const s = (await res.json()) as Session;
      setSession(s);
      return s;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await raw(path, init); // retry once with the new token
  }
  if (!res.ok) throw await toError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function logout() {
  await raw('/auth/logout', { method: 'POST' }, null).catch(() => undefined);
  setSession(null);
}

/** UI hint only (hide buttons the API would refuse); the API checks every permission itself. */
export const can = (s: Session, perm: string) => s.clinic.permissions?.includes('*') || s.clinic.permissions?.includes(perm) || false;

/**
 * Multipart upload with progress (fetch cannot report upload progress, XMLHttpRequest can). Sends the file as `file`
 * (after any `fields`, e.g. a clinical file's kind and caption),
 * refreshes the session once on 401 like `api()`, and turns failures into the same ApiError.
 */
export function uploadFile<T>(path: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal, fields: Record<string, string> = {}): Promise<T> {
  const send = (token: string | null) => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => { let body: unknown = {}; try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON */ } resolve({ status: xhr.status, body }); };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Network error'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled'));
    signal?.addEventListener('abort', () => xhr.abort());
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', file);
    xhr.send(form);
  });
  return (async () => {
    let res = await send(accessToken);
    if (res.status === 401 && (await refreshSession())) res = await send(accessToken);
    const p = res.body as { code?: string; detail?: string; title?: string; errors?: { path: string; message: string }[] };
    if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, p.code ?? 'error', p.detail ?? p.title ?? 'Upload failed', p.errors, p as Record<string, unknown>);
    onProgress(1);
    return res.body as T;
  })();
}
