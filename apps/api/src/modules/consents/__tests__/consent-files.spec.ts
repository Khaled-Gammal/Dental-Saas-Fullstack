import { consentKey, newConsentKey, signaturePng } from '../consent-files';

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('consent files (H9)', () => {
  it('accepts only a PNG data URL from the signature pad', () => {
    expect(signaturePng(`data:image/png;base64,${PNG_1X1}`)?.subarray(1, 4).toString()).toBe('PNG');
    expect(signaturePng(`data:image/jpeg;base64,${PNG_1X1}`)).toBeNull();
    expect(signaturePng('data:image/png;base64,AAAA')).toBeNull(); // not PNG bytes
    expect(signaturePng(`data:image/png;base64,${PNG_1X1}<script>`)).toBeNull();
  });
  it('stores consents under the clinic, and gives new texts short lowercase keys', () => {
    expect(consentKey('t1', 'f1')).toBe('t/t1/consents/f1');
    for (let i = 0; i < 50; i++) expect(newConsentKey()).toMatch(/^c-[a-z0-9]{6}$/);
  });
});
