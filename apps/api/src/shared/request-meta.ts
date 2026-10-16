import { AUTH_POLICY } from '../config';

/** User agents are stored for audit and login history; a capped length keeps a hostile header from bloating rows. */
export const clipUserAgent = (ua: string | undefined | null): string | null => ua?.slice(0, AUTH_POLICY.userAgentMaxLength) ?? null;
