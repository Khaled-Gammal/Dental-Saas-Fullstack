import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators';
import { WebsiteService } from './website.service';

@ApiTags('clinic')
@ApiBearerAuth()
@Controller('clinic/website')
export class WebsiteController {
  constructor(private readonly website: WebsiteService) {}

  @Get()
  status() {
    return this.website.status();
  }

  /** Makes the draft (theme, and later pages) the live website. */
  @Post('publish')
  @HttpCode(200)
  @RequirePermission('settings:write')
  publish() {
    return this.website.publish();
  }
}
