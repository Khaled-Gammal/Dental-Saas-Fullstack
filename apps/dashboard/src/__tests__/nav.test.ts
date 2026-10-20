import { describe, expect, it } from 'vitest';
import { canSee } from '../access';
import { activeGroup, NAV_FOOT, NAV_GROUPS, navPageOf, visibleNav } from '../nav';
import { parseRoute, type Page } from '../router';

const as = (perms: string[]) => {
  const has = (p: string) => perms.includes('*') || perms.includes(p);
  return { has, canSeePage: (p: Page) => canSee(has, p) };
};
const keys = (perms: string[]) => {
  const { has, canSeePage } = as(perms);
  return visibleNav(NAV_GROUPS, canSeePage, has).map((g) => [g.key, g.items.map((i) => i.key)]);
};

describe('sidebar navigation (redesign R1)', () => {
  it('every page in the menu is a real route, and no page is listed twice', () => {
    const pages = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOT].flatMap((i) => (i.page ? [i.page] : []));
    expect(new Set(pages).size).toBe(pages.length);
    for (const p of pages) expect(parseRoute(`#/${p}`)).toEqual({ page: p });
  });
  it('the owner sees every group; the clinic data page only at the foot', () => {
    expect(keys(['*']).map(([k]) => k)).toEqual([null, 'navGroupClinic', 'navGroupFinance', 'navGroupWebsite', 'navGroupTeam']);
    const { has, canSeePage } = as(['*']);
    expect(visibleNav([{ key: null, items: NAV_FOOT }], canSeePage, has)[0].items.map((i) => i.key)).toEqual(['navData']);
  });
  it('a member sees only what they may open; a group left empty disappears', () => {
    const reception = keys(['patients:read', 'patients:write', 'appointments:read', 'appointments:write', 'invoices:read', 'payments:write', 'cash:operate']);
    expect(reception).toEqual([
      [null, ['navOverview', 'navAppointments', 'navPatients', 'navFollowUps']],
      ['navGroupClinic', ['navProfile', 'navBranches', 'navDoctors', 'navServices']], // consents need settings:write
      ['navGroupFinance', ['navBilling', 'navCash']],
    ]);
    const { has, canSeePage } = as(['patients:read']);
    expect(visibleNav([{ key: null, items: NAV_FOOT }], canSeePage, has)).toEqual([]); // not the owner: no clinic data page
  });
  it('the "soon" website item shows only to who will edit the site', () => {
    expect(keys(['website:write']).find(([k]) => k === 'navGroupWebsite')).toEqual(['navGroupWebsite', ['navGallery', 'navWebsite']]);
    expect(keys(['patients:read']).find(([k]) => k === 'navGroupWebsite')).toBeUndefined();
  });
  it('a page without its own item lights its parent, and opens its group', () => {
    expect(navPageOf('visits')).toBe('patients');
    expect(navPageOf('payments')).toBe('invoices');
    expect(navPageOf('holidays')).toBe('branches');
    expect(navPageOf('not-found')).toBeNull();
    expect(activeGroup(NAV_GROUPS, 'payments')).toBe('navGroupFinance');
    expect(activeGroup(NAV_GROUPS, 'booking')).toBe('navGroupClinic');
    expect(activeGroup(NAV_GROUPS, 'patients')).toBeNull(); // the daily links have no group to open
  });
});
