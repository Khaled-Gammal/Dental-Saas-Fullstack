import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Public, RequirePermission } from '../../auth/decorators';
import { AUTH_POLICY } from '../../config';
import { SessionCookie, requestMeta } from '../identity/session-cookie';
import { RATE_LIMITER, type RateLimiter } from '../../shared/rate-limit/ports';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { InvitationAcceptance } from './invitation-acceptance.service';
import { AcceptBody, EditRoleBody, InvitationToken, InviteBody, NewRoleBody, UpdateMemberBody } from './staff.schemas';
import { StaffService } from './staff.service';

const id = new ParseUUIDPipe();
const token = new ZodBody(InvitationToken);

/** Members, roles and invitations of the clinic: the owner's (SRS 2.2 "Staff & roles", ACCESS-001/002). */
@ApiTags('staff')
@ApiBearerAuth()
@RequirePermission('staff:manage')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('members')
  members() { return this.staff.members(); }

  @Get('members/:id')
  member(@Param('id', id) memberId: string) { return this.staff.member(memberId); }

  @Patch('members/:id')
  update(@Param('id', id) memberId: string, @Body(new ZodBody(UpdateMemberBody)) b: z.infer<typeof UpdateMemberBody>) {
    return this.staff.updateMember(memberId, b);
  }

  /** H4: the permissions a role can hold, grouped as the roles screen shows them */
  @Get('permissions')
  permissions() { return this.staff.permissions(); }

  @Get('roles')
  roles() { return this.staff.roles(); }

  /** H4: a custom role (built-in roles are fixed); a member who is not the owner gives only permissions they hold */
  @Post('roles')
  createRole(@Body(new ZodBody(NewRoleBody)) b: z.infer<typeof NewRoleBody>) { return this.staff.createRole(b); }

  @Patch('roles/:id')
  updateRole(@Param('id', id) roleId: string, @Body(new ZodBody(EditRoleBody)) b: z.infer<typeof EditRoleBody>) { return this.staff.updateRole(roleId, b); }

  /** deleted when nobody ever held it, archived when only past members or invitations refer to it */
  @Delete('roles/:id')
  removeRole(@Param('id', id) roleId: string) { return this.staff.removeRole(roleId); }

  @Get('invitations')
  invitations() { return this.staff.invitations(); }

  @Post('invitations')
  invite(@Body(new ZodBody(InviteBody)) b: z.infer<typeof InviteBody>) { return this.staff.invite(b); }

  @Post('invitations/:id/resend') @HttpCode(200)
  resend(@Param('id', id) invitationId: string) { return this.staff.resend(invitationId); }

  @Post('invitations/:id/revoke') @HttpCode(204)
  revoke(@Param('id', id) invitationId: string) { return this.staff.revoke(invitationId); }
}

const T = AUTH_POLICY.throttle;

/** The emailed link, before the invitee has a session. Throttled per IP like the other public auth endpoints. */
@ApiTags('staff')
@Public()
@Controller('public/invitations')
export class InvitationsController {
  constructor(
    private readonly acceptance: InvitationAcceptance,
    private readonly cookie: SessionCookie,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Get(':token')
  async preview(@Param('token', token) t: string, @Req() req: Request) {
    await this.limiter.throttle(`ip:invitation:${req.ip ?? '-'}`, ...T.otpVerify);
    return this.acceptance.preview(t);
  }

  @Post(':token/accept') @HttpCode(200)
  async accept(@Param('token', token) t: string, @Body(new ZodBody(AcceptBody)) b: z.infer<typeof AcceptBody>,
    @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limiter.throttle(`ip:login:${req.ip ?? '-'}`, ...T.login);
    return this.cookie.issue(res, await this.acceptance.accept(t, b, requestMeta(req)));
  }
}
