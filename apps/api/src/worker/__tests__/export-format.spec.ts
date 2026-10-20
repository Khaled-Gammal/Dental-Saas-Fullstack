import { confirmsClinic } from '../../modules/clinic-data/clinic-data.service';
import { csvCell, csvLine, EXPORT_SKIP_TABLES, exportColumns, exportedFile, isSecretColumn, jsonRow, readme } from '../export-format';

describe('clinic data export format (H8, NFR-08)', () => {
  it('never exports a secret: hashes, encrypted values, tokens, passwords, binary columns', () => {
    for (const c of ['password_hash', 'totp_secret_enc', 'token_hash', 'check_in_code_hash', 'manage_token_hash', 'credentials_enc', 'verification_token']) {
      expect([c, isSecretColumn(c)]).toEqual([c, true]);
    }
    for (const c of ['full_name', 'phone', 'amount_minor', 'notes', 'status']) expect([c, isSecretColumn(c)]).toEqual([c, false]);
    expect(exportColumns([
      { name: 'id', type: 'uuid' }, { name: 'manage_token_hash', type: 'text' }, { name: 'blob', type: 'bytea' }, { name: 'starts_at', type: 'timestamp with time zone' },
    ])).toEqual(['id', 'starts_at']);
    for (const t of ['refresh_tokens', 'platform_tenant_notes', 'platform_audit_log', 'data_exports']) expect(EXPORT_SKIP_TABLES.has(t)).toBe(true);
    expect(EXPORT_SKIP_TABLES.has('patients')).toBe(false);
  });

  it('writes CSV that Excel opens safely: quoting, dates in ISO, JSON values, no formulas', () => {
    expect(csvCell('سارة, علي')).toBe('"سارة, علي"');
    expect(csvCell('قال "نعم"')).toBe('"قال ""نعم"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-10-20T08:30:00Z'))).toBe('2026-10-20T08:30:00.000Z');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvLine(['a', 2, true])).toBe('a,2,true\r\n');
    expect(jsonRow({ id: 'x', at: new Date('2026-10-20T00:00:00Z'), gone: undefined, extra: 1 }, ['id', 'at', 'gone'])).toEqual({ id: 'x', at: '2026-10-20T00:00:00.000Z', gone: null });
  });

  it('puts each uploaded file under files/<kind>/<id>, images as their widest rendition', () => {
    expect(exportedFile({ id: 'f1', kind: 'xray', object_key: 't/c/clinical/f1', mime_type: 'image/jpeg', variant_widths: [] }))
      .toEqual({ key: 't/c/clinical/f1', path: 'files/xray/f1.jpg' });
    expect(exportedFile({ id: 'f2', kind: 'gallery', object_key: 't/c/f2', mime_type: 'image/webp', variant_widths: [480, 1600, 960] }))
      .toEqual({ key: 't/c/f2/1600.webp', path: 'files/gallery/f2.webp' });
    expect(exportedFile({ id: 'f3', kind: 'document', object_key: 't/c/expenses/f3', mime_type: 'application/pdf', variant_widths: null }).path).toBe('files/document/f3.pdf');
  });

  it('explains itself in Arabic: money in piasters, UTC times, a warning about patient data', () => {
    const text = readme('عيادة النور', new Date('2026-10-20T00:00:00Z'), [{ name: 'patients', rows: 12 }], 3, 1);
    expect(text).toContain('عيادة النور');
    expect(text).toContain('_minor');
    expect(text).toContain('UTC');
    expect(text).toContain('patients: 12');
    expect(text).toContain('تعذّر العثور على 1');
  });

  it('deletion asks for the clinic name: Arabic or English name or its address, spaces and case ignored', () => {
    const clinic = { name_ar: 'عيادة النور', name_en: 'Nour Clinic', slug: 'nour' };
    expect(confirmsClinic('  عيادة   النور ', clinic)).toBe(true);
    expect(confirmsClinic('nour clinic', clinic)).toBe(true);
    expect(confirmsClinic('NOUR', clinic)).toBe(true);
    expect(confirmsClinic('عيادة', clinic)).toBe(false);
    expect(confirmsClinic('', { name_ar: '', name_en: null, slug: 'x' })).toBe(false);
  });
});
