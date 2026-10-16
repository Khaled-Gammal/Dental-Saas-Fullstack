/**
 * The visitor's address for the API's per-IP throttles: the right-most X-Forwarded-For entry (the one our edge proxy
 * wrote; Caddy replaces any client-supplied value), else X-Real-IP, else null. Junk is dropped, never passed on.
 */
const IP = /^[0-9a-f.:]{3,45}$/i;

export function clientIp(headers: Headers): string | null {
  const chain = headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const candidate = chain[chain.length - 1] ?? headers.get('x-real-ip')?.trim();
  return candidate && IP.test(candidate) ? candidate : null;
}
