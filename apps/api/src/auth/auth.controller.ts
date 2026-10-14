import { Body, Controller, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { sql } from '@dental/db';
import { APP_CONFIG, type AppConfig } from '../config';
import { TenantDb } from '../shared/database/tenant-db.service';
import type { RequestContext } from '../shared/context/request-context';
import { ZodBody } from '../shared/validation/zod-body.pipe';
import { Public } from './decorators';
import type { AccessTokenPayload } from './jwt-auth.guard';

const DevLogin = z.object({
  email: z.string().email(),
  clinic: z.string().optional(), // tenant slug, when the user works at several clinics
});

interface Membership {
  tenant_id: string;
  slug: string;
  name_en: string | null;
  name_ar: string | null;
  tenant_status: string;
  role_key: string;
  member_status: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly jwt: JwtService,
    private readonly db: TenantDb,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /**
   * DEVELOPMENT ONLY: sign in as a seeded user without a password.
   * Disabled unless DEV_LOGIN_ENABLED=true, and refused at startup in production.
   * Real login (password + OTP + refresh tokens) is the week-2 identity slice.
   */
  @Public()
  @Post('dev-login')
  async devLogin(@Body(new ZodBody(DevLogin)) body: z.infer<typeof DevLogin>) {
    if (!this.cfg.DEV_LOGIN_ENABLED) throw new NotFoundException();

    const user = await this.db.raw.selectFrom('users').select(['id', 'full_name']).where('email', '=', body.email).executeTakeFirst();
    if (!user) throw new NotFoundException('No such user');

    const { rows } = await sql<Membership>`select * from memberships_for_user(${user.id})`.execute(this.db.raw);
    const m = rows.find((r) => r.member_status === 'active' && (!body.clinic || r.slug === body.clinic));
    if (!m) throw new NotFoundException('User has no active clinic');

    const member = await this.db.runAs(m.tenant_id, (tx) =>
      tx.selectFrom('tenant_members as tm')
        .innerJoin('roles as r', 'r.id', 'tm.role_id')
        .select(['tm.id', 'r.permissions'])
        .where('tm.user_id', '=', user.id)
        .executeTakeFirstOrThrow(),
    );

    const payload: AccessTokenPayload = { sub: user.id, tid: m.tenant_id, mid: member.id, perms: member.permissions };
    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: '12h' }),
      user: { id: user.id, name: user.full_name },
      clinic: { id: m.tenant_id, slug: m.slug, nameEn: m.name_en, nameAr: m.name_ar, role: m.role_key },
      clinics: rows.map((r) => ({ slug: r.slug, nameEn: r.name_en, nameAr: r.name_ar })),
    };
  }

  @ApiBearerAuth()
  @Get('me')
  me() {
    return {
      userId: this.cls.get('userId'),
      tenantId: this.cls.get('tenantId'),
      memberId: this.cls.get('memberId'),
      permissions: this.cls.get('permissions'),
    };
  }
}
