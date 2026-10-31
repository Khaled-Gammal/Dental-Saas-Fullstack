/** Injection token for the app_user Kysely instance. */
export const DB = Symbol('DB');

/** Injection token for the app_platform Kysely instance: the platform admin panel only (review R11). */
export const PLATFORM_DB = Symbol('PLATFORM_DB');
