import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { BranchSlug, DisplayName, E164Phone } from '../../shared/validation/common';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { BranchesService } from './branches.service';

const CreateBranch = z
  .object({
    nameEn: DisplayName.optional(),
    nameAr: DisplayName.optional(),
    slug: BranchSlug,
    city: z.string().trim().max(80).optional(),
    phone: E164Phone.optional(), // stored as E.164
  })
  .refine((b) => b.nameEn || b.nameAr, { message: 'nameEn or nameAr is required' });

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermission('branches:read')
  list() {
    return this.branches.list();
  }

  @Post()
  @RequirePermission('branches:write')
  create(@Body(new ZodBody(CreateBranch)) body: z.infer<typeof CreateBranch>) {
    return this.branches.create(body);
  }
}
