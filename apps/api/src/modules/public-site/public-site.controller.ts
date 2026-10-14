import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../auth/decorators';
import { Err } from '../../shared/errors/app-error';
import { PublicSiteRepository } from './public-site.repository';

const Host = z.string().trim().toLowerCase().max(253).catch('');
const notFound = () => Err.notFound('site_not_found', 'No clinic at this address');

/**
 * Read-only data for a clinic's public website, for the hostname the visitor typed.
 * Only published, non-medical data; one transaction, one data query.
 * Draft sites are served on purpose: the owner previews the site while onboarding (SRS WEB-05).
 * Suspended/cancelled clinics and unverified domains resolve to nothing (resolve_tenant_by_host).
 */
@ApiTags('public')
@Controller('public')
export class PublicSiteController {
  constructor(private readonly repo: PublicSiteRepository) {}

  @Public()
  @Get('site')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  @ApiQuery({ name: 'host', example: 'clinic-a.lvh.me' })
  async site(@Query('host') raw: unknown) {
    const hostname = Host.parse(raw).split(':')[0].replace(/\.$/, '');
    if (!hostname) throw notFound();
    const payload = await this.repo.loadForHost(hostname);
    if (!payload?.clinic) throw notFound();
    return payload;
  }
}
