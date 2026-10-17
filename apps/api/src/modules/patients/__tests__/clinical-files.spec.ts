import { ClinicalFileSigner, clinicalKey, sniff } from '../clinical-files';

const pad = (head: number[] | string) => Buffer.concat([typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head), Buffer.alloc(16)]);

describe('sniff', () => {
  it('recognises PDF, JPEG, PNG and WebP by their bytes', () => {
    expect(sniff(pad('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(sniff(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniff(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe('image/png');
    expect(sniff(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'), Buffer.alloc(8)]))?.mime).toBe('image/webp');
  });
  it('refuses everything else, whatever it is called (HTML, SVG, scripts, tiny files)', () => {
    expect(sniff(pad('<html><script>'))).toBeNull();
    expect(sniff(pad('<svg xmlns='))).toBeNull();
    expect(sniff(Buffer.from('%PDF'))).toBeNull();
  });
});

describe('ClinicalFileSigner', () => {
  const s = new ClinicalFileSigner('test-secret-0123456789', 'https://api.example');
  const now = Date.parse('2031-01-01T10:00:00Z');
  const parts = (url: string) => Object.fromEntries(new URL(url).searchParams);
  it('a link works for its clinic, file and user until it expires', () => {
    const p = parts(s.url('t1', 'f1', 'u1', 300, now));
    expect(s.verify('t1', 'f1', 'u1', Number(p.exp), p.sig, now)).toBe(true);
    expect(s.verify('t1', 'f1', 'u1', Number(p.exp), p.sig, now + 301_000)).toBe(false);
  });
  it('cannot be moved to another file, clinic or user, nor extended', () => {
    const p = parts(s.url('t1', 'f1', 'u1', 300, now));
    expect(s.verify('t1', 'f2', 'u1', Number(p.exp), p.sig, now)).toBe(false);
    expect(s.verify('t2', 'f1', 'u1', Number(p.exp), p.sig, now)).toBe(false);
    expect(s.verify('t1', 'f1', 'u2', Number(p.exp), p.sig, now)).toBe(false);
    expect(s.verify('t1', 'f1', 'u1', Number(p.exp) + 3600, p.sig, now)).toBe(false);
  });
  it('keys are lower-case storage paths', () => {
    expect(clinicalKey('11111111-1111-1111-1111-111111111111', 'aa')).toBe('t/11111111-1111-1111-1111-111111111111/clinical/aa');
  });
});
