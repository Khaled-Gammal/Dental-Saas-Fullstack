import { type ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../../shared/context/request-context';
import { type TenantDb } from '../../../shared/database/tenant-db.service';
import { Err } from '../../../shared/errors/app-error';
import type { Session, TenantScope } from '../application/ports';

const siteNotFound = () => Err.notFound('site_not_found', 'No clinic at this address');

/** A public website request: the clinic is whoever owns the hostname (suspended clinics resolve to nothing). */
export function hostScope(db: TenantDb, host: string): TenantScope {
  const run = async <T>(fn: (tx: Session, tenantId: string) => Promise<T>): Promise<T> => {
    const out = await db.runForHost(host, async (tx, tenantId) => ({ value: await fn(tx, tenantId) }));
    if (!out) throw siteNotFound();
    return out.value;
  };
  return { run, resolve: () => run(async (_tx, tenantId) => tenantId) };
}

/** A dashboard request: the clinic comes from the access token. */
export function sessionScope(db: TenantDb, cls: ClsService<RequestContext>): TenantScope {
  return {
    run: (fn) => db.run(fn),
    resolve: async () => {
      const id = cls.get('tenantId');
      if (!id) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
      return id;
    },
  };
}
