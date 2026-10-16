import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../auth/decorators';
import { BranchSlug, DisplayName, E164Phone } from '../../shared/validation/common';
import { ZodBody } from '../../shared/validation/zod-body.pipe';
import { BranchesService } from './branches.service';
import { WeeklyHours, type WeeklyHoursInput } from './hours';

const Address = z.string().trim().min(3).max(300);
const City = z.string().trim().min(2).max(80);

const CreateBranch = z
  .object({
    nameEn: DisplayName.optional(),
    nameAr: DisplayName.optional(),
    slug: BranchSlug,
    city: City.optional(),
    phone: E164Phone.optional(), // stored as E.164
  })
  .refine((b) => b.nameEn || b.nameAr, { message: 'nameEn or nameAr is required' });

/** Every field optional; null clears it. A branch must keep at least one name (DB CHECK). */
const UpdateBranch = z.object({
  nameEn: DisplayName.nullable().optional(),
  nameAr: DisplayName.nullable().optional(),
  addressEn: Address.nullable().optional(),
  addressAr: Address.nullable().optional(),
  city: City.nullable().optional(),
  phone: E164Phone.nullable().optional(),
  whatsapp: E164Phone.nullable().optional(),
  isActive: z.boolean().optional(),
  photoFileId: z.string().uuid().nullable().optional(), // an image uploaded with ?purpose=photo; null removes it
}).strict();

// any UUID shape (seed ids are not v4); a malformed id is a 400, an unknown one a 404
const id = new ParseUUIDPipe();

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  // reads of setup data (it is public on the clinic website) need only membership; writes need the permission
  @Get()
  list() {
    return this.branches.list();
  }

  @Get(':id')
  get(@Param('id', id) branchId: string) {
    return this.branches.get(branchId);
  }

  @Post()
  @RequirePermission('branches:write')
  create(@Body(new ZodBody(CreateBranch)) body: z.infer<typeof CreateBranch>) {
    return this.branches.create(body);
  }

  @Patch(':id')
  @RequirePermission('branches:write')
  update(@Param('id', id) branchId: string, @Body(new ZodBody(UpdateBranch)) body: z.infer<typeof UpdateBranch>) {
    return this.branches.update(branchId, body);
  }

  /** Makes this the main branch (shown first on the website); the previous main stops being main. */
  @Post(':id/main')
  @HttpCode(200)
  @RequirePermission('branches:write')
  makeMain(@Param('id', id) branchId: string) {
    return this.branches.makeMain(branchId);
  }

  /** Replaces the branch's whole weekly schedule (split shifts allowed, up to 3 a day). */
  @Put(':id/hours')
  @RequirePermission('branches:write')
  replaceHours(@Param('id', id) branchId: string, @Body(new ZodBody(WeeklyHours)) body: WeeklyHoursInput) {
    return this.branches.replaceHours(branchId, body);
  }
}
