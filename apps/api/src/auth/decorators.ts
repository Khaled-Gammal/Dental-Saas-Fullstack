import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS = 'permissions';

/** Endpoint needs no login (health, public website, login itself). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** H6: reachable while the member still has legal documents to accept (every other clinic route refuses them). */
export const ALLOW_LEGAL_PENDING = 'allowLegalPending';
export const AllowLegalPending = () => SetMetadata(ALLOW_LEGAL_PENDING, true);

/** Caller's role must include every listed permission (or '*'). */
export const RequirePermission = (...perms: string[]) => SetMetadata(PERMISSIONS, perms);
