/**
 * The owner's «بيانات العيادة» page (H8, NFR-08): the clinic's data exports and the deletion request. Pure parts,
 * unit-tested.
 */
export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';
export interface ExportRow {
  id: string; status: ExportStatus; size_bytes: number | null; files_count: number | null;
  created_at: string; finished_at: string | null; expires_at: string | null;
}

export const EXPORT_TONE: Record<ExportStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  queued: 'primary', running: 'primary', ready: 'success', failed: 'warning', expired: 'neutral',
};

/** An export is being prepared: the page checks again every few seconds and does not offer another. */
export const exportBusy = (rows: readonly ExportRow[]) => rows.some((r) => r.status === 'queued' || r.status === 'running');

/** A ready export the owner can still download (its days are not over). */
export const downloadable = (r: ExportRow, now = Date.now()) => r.status === 'ready' && !!r.expires_at && new Date(r.expires_at).getTime() > now;

/** "12.5 ميجابايت": Latin digits, one decimal under 10. */
export function sizeText(bytes: number | null): string {
  if (bytes == null) return '—';
  const units = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const n = i === 0 || v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${n.toLocaleString('en-US')} ${units[i]}`;
}

/** The typed name matches the clinic's Arabic or English name or its address (the API checks the same way). */
export function confirmsClinic(typed: string, clinic: { nameAr: string | null; nameEn: string | null; slug: string }): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const t = norm(typed);
  return t.length > 0 && [clinic.nameAr, clinic.nameEn, clinic.slug].some((n) => !!n && norm(n) === t);
}
