import { describe, expect, it } from 'vitest';
import { canOpen, canSee } from '../access';
import { confirmsClinic, downloadable, exportBusy, sizeText, type ExportRow } from '../clinic-data-model';
import { parseRoute } from '../router';

const row = (over: Partial<ExportRow>): ExportRow => ({
  id: 'e1', status: 'ready', size_bytes: 1024, files_count: 3, created_at: '2026-10-20T10:00:00Z', finished_at: null, expires_at: '2026-10-27T10:00:00Z', ...over,
});

describe('the owner\'s «بيانات العيادة» page (H8)', () => {
  it('is the owner\'s only: no role the owner creates opens it, whatever it holds', () => {
    const owner = () => true; // the owner's '*' answers yes to every permission
    const manager = (p: string) => ['staff:manage', 'settings:write', 'reports:read', 'expenses:read', 'invoices:read'].includes(p);
    expect(parseRoute('#/data')).toEqual({ page: 'data' });
    expect(canOpen(owner, parseRoute('#/data'))).toBe(true);
    expect(canSee(owner, 'data')).toBe(true);
    expect(canOpen(manager, parseRoute('#/data'))).toBe(false);
    expect(canSee(manager, 'data')).toBe(false);
  });
  it('checks again while an export is being prepared, and offers only unexpired ones for download', () => {
    expect(exportBusy([row({ status: 'ready' }), row({ status: 'running' })])).toBe(true);
    expect(exportBusy([row({ status: 'ready' }), row({ status: 'failed' })])).toBe(false);
    const now = new Date('2026-10-21T00:00:00Z').getTime();
    expect(downloadable(row({}), now)).toBe(true);
    expect(downloadable(row({ expires_at: '2026-10-20T23:00:00Z' }), now)).toBe(false);
    expect(downloadable(row({ status: 'expired' }), now)).toBe(false);
  });
  it('shows sizes in Arabic units with Latin digits', () => {
    expect(sizeText(null)).toBe('—');
    expect(sizeText(512)).toBe('512 بايت');
    expect(sizeText(1536)).toBe('1.5 كيلوبايت');
    expect(sizeText(25 * 1024 * 1024)).toBe('25 ميجابايت');
    expect(sizeText(3.25 * 1024 ** 3)).toBe('3.3 جيجابايت');
  });
  it('the delete button waits for the clinic name, as the API checks it', () => {
    const clinic = { nameAr: 'عيادة النور', nameEn: 'Nour Clinic', slug: 'nour' };
    expect(confirmsClinic(' عيادة  النور', clinic)).toBe(true);
    expect(confirmsClinic('nour clinic', clinic)).toBe(true);
    expect(confirmsClinic('nour', clinic)).toBe(true);
    expect(confirmsClinic('النور', clinic)).toBe(false);
  });
});
