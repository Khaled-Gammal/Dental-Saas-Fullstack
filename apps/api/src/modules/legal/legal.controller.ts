import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { AllowLegalPending, Public } from '../../auth/decorators';
import { hasPermission } from '../../auth/permissions';
import type { RequestContext } from '../../shared/context/request-context';
import { clipUserAgent } from '../../shared/request-meta';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { LegalService } from './legal.service';

const Kind = z.enum(['terms', 'privacy', 'dpa']);
const Accept = z.object({ documentIds: z.array(z.string().uuid()).min(1).max(10) }).strict();

/** The platform's legal documents, readable by anyone (sign-up and invitation pages link to them). */
@ApiTags('legal')
@Public()
@Controller('public/legal')
export class PublicLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  current() { return this.legal.current(); }

  @Get(':kind')
  document(@Param('kind', new ZodBody(Kind)) kind: z.infer<typeof Kind>) { return this.legal.document(kind); }
}

/**
 * A signed-in member accepts the documents their session lists as pending (a new version that asks to be accepted
 * again, or one they never accepted). Open while acceptance is pending; afterwards the dashboard refreshes the session.
 */
@ApiTags('legal')
@ApiBearerAuth()
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService, private readonly cls: ClsService<RequestContext>) {}

  @Post('accept') @HttpCode(204)
  @AllowLegalPending()
  accept(@Body(new ZodBody(Accept)) b: z.infer<typeof Accept>, @Req() req: Request): Promise<void> {
    const owner = hasPermission(this.cls.get('permissions'), '*'); // the owner role is the only one holding '*'
    return this.legal.acceptPending(this.cls.get('userId')!, this.cls.get('tenantId')!, owner, b.documentIds,
      { ip: req.ip ?? null, userAgent: clipUserAgent(req.headers['user-agent']) });
  }
}
