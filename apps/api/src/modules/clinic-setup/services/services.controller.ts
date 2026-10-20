import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../../auth/decorators';
import { DisplayName } from '../../../shared/validation/common';
import { ZodBody } from '../../../shared/validation/zod-body.pipe';
import { ServicesService } from './services.service';

const Description = z.string().trim().max(1000).transform((v) => v || null);
/** Whole piastres, up to 1,000,000 EGP. 0 = "price on consultation". */
const Minor = z.number().int().min(0).max(100_000_000);
const Duration = z.number().int().min(5).max(480);
const ConsentKey = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/);

const CreateService = z.object({
  catalogCode: z.string().trim().regex(/^[a-z0-9_]{2,40}$/).optional(),
  nameAr: DisplayName.optional(),
  nameEn: DisplayName.optional(),
  descriptionAr: Description.optional(),
  descriptionEn: Description.optional(),
  priceMinor: Minor.optional(),
  priceMaxMinor: Minor.nullable().optional(),
  durationMinutes: Duration.optional(), // required unless the catalogue supplies it
  bookableOnline: z.boolean().optional(),
  showOnWebsite: z.boolean().optional(),
  imageFileId: z.string().uuid().nullable().optional(), // an image uploaded with ?purpose=photo
  consentKey: ConsentKey.nullable().optional(), // H9: the consent this treatment needs
}).strict();

const UpdateService = z.object({
  nameAr: DisplayName.nullable().optional(),
  nameEn: DisplayName.nullable().optional(),
  descriptionAr: Description.nullable().optional(),
  descriptionEn: Description.nullable().optional(),
  priceMinor: Minor.optional(),
  priceMaxMinor: Minor.nullable().optional(),
  durationMinutes: Duration.optional(),
  bookableOnline: z.boolean().optional(),
  showOnWebsite: z.boolean().optional(),
  isActive: z.boolean().optional(),
  imageFileId: z.string().uuid().nullable().optional(), // null removes the image
  consentKey: ConsentKey.nullable().optional(), // null: no consent needed
}).strict();

const id = new ParseUUIDPipe();

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list() {
    return this.services.list();
  }

  /** The dental catalogue to pick from when adding a service. */
  @Get('catalog')
  catalog() {
    return this.services.catalog();
  }

  @Post()
  @RequirePermission('settings:write')
  create(@Body(new ZodBody(CreateService)) body: z.infer<typeof CreateService>) {
    return this.services.create(body);
  }

  @Patch(':id')
  @RequirePermission('settings:write')
  update(@Param('id', id) serviceId: string, @Body(new ZodBody(UpdateService)) body: z.infer<typeof UpdateService>) {
    return this.services.update(serviceId, body);
  }
}
