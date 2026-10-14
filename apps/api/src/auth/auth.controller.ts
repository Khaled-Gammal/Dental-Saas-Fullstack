import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../shared/context/request-context';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  /** Who the access token says you are (debugging and the dashboard's permission checks). */
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
