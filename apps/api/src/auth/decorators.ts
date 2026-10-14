import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS = 'permissions';

/** Endpoint needs no login (health, public website, login itself). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller's role must include every listed permission (or '*'). */
export const RequirePermission = (...perms: string[]) => SetMetadata(PERMISSIONS, perms);
