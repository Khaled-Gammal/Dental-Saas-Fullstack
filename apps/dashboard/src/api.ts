const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

/** RFC 9457 error from the API. `code` is stable; `detail` is shown to the user. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, detail: string) {
    super(detail);
  }
}

let token: string | null = sessionStorage.getItem('token');
export const setToken = (t: string | null) => {
  token = t;
  if (t) sessionStorage.setItem('token', t);
  else sessionStorage.removeItem('token');
};
export const hasToken = () => !!token;

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!res.ok) {
    const p = await res.json().catch(() => ({}));
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, p.code ?? 'error', p.detail ?? p.title ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
