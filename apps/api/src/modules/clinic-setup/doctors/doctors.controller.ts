import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../../auth/decorators';
import { DisplayName } from '../../../shared/validation/common';
import { ZodBody } from '../../../shared/validation/zod-body.pipe';
import { DoctorsService } from './doctors.service';
import { DoctorSchedule, type DoctorScheduleInput } from './schedule';

const Title = z.string().trim().min(2).max(120);
const Bio = z.string().trim().max(1000).transform((v) => v || null);
const Specialties = z.array(z.string().trim().min(2).max(60)).max(10);
const BranchIds = z.array(z.string().uuid()).max(20).transform((ids) => [...new Set(ids)]); // the same branch twice is one branch

const CreateDoctor = z.object({
  nameAr: DisplayName.optional(),
  nameEn: DisplayName.optional(),
  titleAr: Title.optional(),
  titleEn: Title.optional(),
  bioAr: Bio.optional(),
  bioEn: Bio.optional(),
  specialties: Specialties.optional(),
  showOnWebsite: z.boolean().optional(),
  acceptsOnlineBooking: z.boolean().optional(),
  branchIds: BranchIds.optional(),
  photoFileId: z.string().uuid().nullable().optional(), // an image uploaded with ?purpose=photo
}).strict().refine((d) => d.nameAr || d.nameEn, { message: 'nameAr or nameEn is required' });

const UpdateDoctor = z.object({
  nameAr: DisplayName.nullable().optional(),
  nameEn: DisplayName.nullable().optional(),
  titleAr: Title.nullable().optional(),
  titleEn: Title.nullable().optional(),
  bioAr: Bio.nullable().optional(),
  bioEn: Bio.nullable().optional(),
  specialties: Specialties.optional(),
  showOnWebsite: z.boolean().optional(),
  acceptsOnlineBooking: z.boolean().optional(),
  isActive: z.boolean().optional(),
  branchIds: BranchIds.optional(),
  photoFileId: z.string().uuid().nullable().optional(), // null removes the photo
}).strict();

const id = new ParseUUIDPipe();

@ApiTags('doctors')
@ApiBearerAuth()
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  list() {
    return this.doctors.list(); // every member may see the team
  }

  @Get(':id')
  get(@Param('id', id) doctorId: string) {
    return this.doctors.get(doctorId);
  }

  @Post()
  @RequirePermission('settings:write')
  create(@Body(new ZodBody(CreateDoctor)) body: z.infer<typeof CreateDoctor>) {
    return this.doctors.create(body);
  }

  @Patch(':id')
  @RequirePermission('settings:write')
  update(@Param('id', id) doctorId: string, @Body(new ZodBody(UpdateDoctor)) body: z.infer<typeof UpdateDoctor>) {
    return this.doctors.update(doctorId, body);
  }

  /** Replaces the doctor's weekly schedule across branches. */
  @Put(':id/schedule')
  @RequirePermission('settings:write')
  replaceSchedule(@Param('id', id) doctorId: string, @Body(new ZodBody(DoctorSchedule)) body: DoctorScheduleInput) {
    return this.doctors.replaceSchedule(doctorId, body);
  }
}
