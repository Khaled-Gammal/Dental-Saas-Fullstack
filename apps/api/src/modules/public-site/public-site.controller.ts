import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { sql } from '@dental/db';
import { Public } from '../../auth/decorators';
import { TenantDb } from '../../shared/database/tenant-db.service';

/**
 * Read-only data for a clinic's public website. The Next.js app calls this with the hostname
 * the visitor typed; only published, non-medical data is returned.
 */
@ApiTags('public')
@Controller('public')
export class PublicSiteController {
  constructor(private readonly db: TenantDb) {}

  @Public()
  @Get('site')
  @ApiQuery({ name: 'host', example: 'clinic-a.lvh.me' })
  async site(@Query('host') host?: string) {
    const hostname = (host ?? '').toLowerCase().split(':')[0];
    if (!hostname) throw new NotFoundException('host is required');

    const { rows } = await sql<{ tenant_id: string | null }>`select resolve_tenant_by_host(${hostname}) as tenant_id`.execute(this.db.raw);
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) throw new NotFoundException({ message: 'No clinic at this address', code: 'site_not_found' });

    return this.db.runAs(tenantId, async (tx) => {
      const clinic = await tx
        .selectFrom('tenants')
        .select(['slug', 'name_en', 'name_ar', 'about_en', 'about_ar', 'primary_phone', 'whatsapp', 'specialties', 'default_locale'])
        .executeTakeFirstOrThrow();
      const site = await tx.selectFrom('sites').select(['published_theme', 'show_powered_by']).executeTakeFirst();
      const branches = await tx
        .selectFrom('branches')
        .select(['id', 'name_en', 'name_ar', 'address_en', 'address_ar', 'city', 'phone', 'latitude', 'longitude'])
        .where('is_active', '=', true)
        .orderBy('is_main', 'desc')
        .execute();
      const hours = await tx.selectFrom('branch_hours').select(['branch_id', 'weekday', 'opens_at', 'closes_at']).orderBy('weekday').execute();
      const services = await tx
        .selectFrom('services')
        .select(['id', 'name_en', 'name_ar', 'price_minor', 'price_max_minor', 'duration_minutes'])
        .where('show_on_website', '=', true)
        .where('is_active', '=', true)
        .orderBy('sort_order')
        .execute();
      const doctors = await tx
        .selectFrom('doctors')
        .select(['id', 'name_en', 'name_ar', 'title_en', 'title_ar', 'specialties'])
        .where('show_on_website', '=', true)
        .where('is_active', '=', true)
        .orderBy('sort_order')
        .execute();
      return {
        clinic,
        theme: site?.published_theme ?? {},
        showPoweredBy: site?.show_powered_by ?? true,
        branches: branches.map((b) => ({ ...b, hours: hours.filter((h) => h.branch_id === b.id) })),
        services,
        doctors,
      };
    });
  }
}
