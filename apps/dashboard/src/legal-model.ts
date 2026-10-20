/**
 * The platform's legal documents on the dashboard (H6, NFR-15): which document a `#/legal/<kind>` link opens, and the
 * ids a person accepts. Pure, unit-tested.
 */
export type LegalKind = 'terms' | 'privacy' | 'dpa';
export interface LegalDoc { id: string; kind: LegalKind; version: number; title_ar: string; published_at?: string }

const KINDS: readonly LegalKind[] = ['terms', 'privacy', 'dpa'];

/** `#/legal/terms` → 'terms'; null for any other hash (the page opens without a session). */
export function parseLegalRoute(hash: string): LegalKind | null {
  const m = /^#\/legal\/([a-z]+)\/?(\?.*)?$/.exec(hash);
  return m && (KINDS as readonly string[]).includes(m[1]) ? (m[1] as LegalKind) : null;
}

export const legalHref = (kind: LegalKind) => `#/legal/${kind}`;

/** The documents a person accepts: staff Terms and Privacy, the owner (or an invited owner) the DPA too. */
export const docsFor = (docs: readonly LegalDoc[], owner: boolean): LegalDoc[] => docs.filter((d) => owner || d.kind !== 'dpa');
