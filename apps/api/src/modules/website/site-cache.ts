import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';

/**
 * Tells the Next.js website to drop its cached copy of a clinic's pages right away
 * (otherwise a change shows up within the normal 60-second revalidation).
 * Best effort: a failure is logged, never surfaced; the cache expires on its own.
 */
@Injectable()
export class SiteCache {
  private readonly logger = new Logger('SiteCache');
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async purge(hostnames: string[]): Promise<void> {
    if (!hostnames.length) return;
    try {
      const res = await fetch(`${this.cfg.WEB_INTERNAL_URL}/api/revalidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': this.cfg.REVALIDATE_SECRET },
        body: JSON.stringify({ tags: hostnames.map((h) => `site:${h}`) }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) this.logger.warn(`revalidate returned ${res.status}`);
    } catch (err) {
      this.logger.warn(`revalidate failed: ${(err as Error).message}`);
    }
  }
}
