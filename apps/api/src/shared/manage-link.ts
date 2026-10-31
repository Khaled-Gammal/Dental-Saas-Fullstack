import { createHash, createHmac } from 'node:crypto';

/**
 * Phase 2E: the patient's own link to their booking, `https://<clinic site>/appointment/<token>` (cancel or move it).
 * The token is derived from the appointment id with a server secret, so the worker can put the same link in every
 * email (confirmation, reminders, a move) without the link ever being stored: the database keeps only its SHA-256
 * (`appointments.manage_token_hash`, unique) to find the booking. 256 bits: not guessable; the public endpoints are
 * throttled per address anyway.
 *
 * Queued emails hold a placeholder (MANAGE_LINK_SLOT), never the link: the sender fills it in at send time, so the
 * notifications table (and a clinic's data export of it) never holds a working link.
 *
 * The key is BOOKING_CODE_SECRET: changing it makes every link already emailed invalid (the page then says so and
 * gives the clinic's phone); the links in emails sent after the change are new and work.
 */
const LABEL = 'appointment-manage-link:v1:';

/** The link's secret part for one appointment (43 URL-safe characters). */
export function manageToken(secret: string, appointmentId: string): string {
  return createHmac('sha256', secret).update(LABEL + appointmentId).digest('base64url');
}

/** What the database stores and looks the booking up by. */
export const manageTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A token as it appears in a link (anything else is refused before any lookup). */
export const MANAGE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The site's origin for a hostname: plain http only for local development hostnames (same rule as the website). */
export const siteOrigin = (host: string): string => `${/(^|\.)(lvh\.me|localhost)$/.test(host) ? 'http' : 'https'}://${host}`;

/** The full link, or null when the clinic has no live site address (or no secret is configured). */
export function manageUrl(secret: string, host: string | null | undefined, appointmentId: string): string | null {
  if (!secret || !host) return null;
  return `${siteOrigin(host)}/appointment/${manageToken(secret, appointmentId)}`;
}

/** Where a queued email's link goes (not a word, so the Arabic-only checks need no exception). */
export const MANAGE_LINK_SLOT = '⟦رابط الموعد⟧';

/** An email body at send time: the link in its place, or — no link to give any more — the line that held it removed. */
export function fillManageLink(body: string, url: string | null): string {
  if (!body.includes(MANAGE_LINK_SLOT)) return body;
  if (url) return body.split(MANAGE_LINK_SLOT).join(url);
  return body.split('\n').filter((line) => !line.includes(MANAGE_LINK_SLOT)).join('\n');
}

/** The secret, for the worker (no Nest container there): the same BOOKING_CODE_SECRET the API reads from its config. */
export const manageLinkSecret = (): string => process.env.BOOKING_CODE_SECRET ?? '';
