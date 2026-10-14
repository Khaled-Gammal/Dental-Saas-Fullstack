import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { BranchesService } from './branches.service';

const CreateBranch = z
  .object({
    nameEn: z.string().min(2).max(120).optional(),
    nameAr: z.string().min(2).max(120).optional(),
    slug: z.string().regex(/^[a-z0-9-]{2,60}$/, 'lowercase letters, digits and dashes'),
    city: z.string().max(80).optional(),
    phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'international format, e.g. +201001234567').optional(),
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
