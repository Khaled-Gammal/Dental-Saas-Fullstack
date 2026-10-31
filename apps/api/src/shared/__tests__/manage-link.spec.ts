import { fillManageLink, MANAGE_LINK_SLOT, MANAGE_TOKEN_RE, manageToken, manageTokenHash, manageUrl, siteOrigin } from '../manage-link';

describe('the patient\'s own link (Phase 2E)', () => {
  const id = '3f2a1b4c-0000-4000-8000-000000000001';
  it('is the same for the same booking (the worker can put it in every email), different for another or another secret', () => {
    const t = manageToken('secret-one-xxxxxxxxxxxxxxxx', id);
    expect(t).toBe(manageToken('secret-one-xxxxxxxxxxxxxxxx', id));
    expect(MANAGE_TOKEN_RE.test(t)).toBe(true);
    expect(manageToken('secret-one-xxxxxxxxxxxxxxxx', '3f2a1b4c-0000-4000-8000-000000000002')).not.toBe(t);
    expect(manageToken('secret-two-xxxxxxxxxxxxxxxx', id)).not.toBe(t);
  });
  it('only its hash is stored', () => {
    const t = manageToken('s'.repeat(32), id);
    expect(manageTokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(manageTokenHash(t)).not.toContain(t);
  });
  it('lives on the clinic\'s own site; no address or secret, no link', () => {
    expect(manageUrl('s'.repeat(32), 'www.drclinic.com', id)).toBe(`https://www.drclinic.com/appointment/${manageToken('s'.repeat(32), id)}`);
    expect(siteOrigin('clinic-a.lvh.me')).toBe('http://clinic-a.lvh.me');
    expect(manageUrl('s'.repeat(32), null, id)).toBeNull();
    expect(manageUrl('', 'www.drclinic.com', id)).toBeNull();
  });
  it('a malformed token is refused by its shape', () => {
    for (const bad of ['', 'short', `${'a'.repeat(43)}=`, `${'a'.repeat(42)}/`, "x' or 1=1 --xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]) expect(MANAGE_TOKEN_RE.test(bad)).toBe(false);
  });
  it('queued emails hold a placeholder; at send time the link goes in, or its line goes away', () => {
    const body = `موعدك غدًا.\nلإلغاء الموعد أو تغييره: ${MANAGE_LINK_SLOT}\nالفرع: مدينة نصر`;
    expect(fillManageLink(body, 'https://x.test/appointment/t')).toBe('موعدك غدًا.\nلإلغاء الموعد أو تغييره: https://x.test/appointment/t\nالفرع: مدينة نصر');
    expect(fillManageLink(body, null)).toBe('موعدك غدًا.\nالفرع: مدينة نصر');
    expect(fillManageLink('بدون رابط', null)).toBe('بدون رابط');
  });
});
