import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../../auth/decorators';
import { DisplayName, E164Phone } from '../../../shared/validation/common';
import { ZodBody } from '../../../shared/validation/zod-body.pipe';
import { ProfileService } from './profile.service';

/** Blank text means "clear it" (stored as null), so a field of spaces never counts as filled in. */
const About = z.string().trim().max(1000).transform((v) => v || null);

/** Every field optional; null clears it. The DB keeps at least one clinic name (CHECK). */
const UpdateProfile = z.object({
  nameAr: DisplayName.nullable().optional(),
  nameEn: DisplayName.nullable().optional(),
  aboutAr: About.nullable().optional(),
  aboutEn: About.nullable().optional(),
  primaryPhone: E164Phone.nullable().optional(),
  whatsapp: E164Phone.nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  specialties: z.array(z.string().trim().min(2).max(60)).max(12).optional(),
  defaultLocale: z.enum(['ar', 'en']).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'an ISO currency code such as EGP').optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #1d6fd8').optional(),
  logoFileId: z.string().uuid().nullable().optional(), // an image uploaded with ?purpose=logo; null removes it
}).strict();

@ApiTags('clinic')
@ApiBearerAuth()
@Controller('clinic/profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  get() {
    return this.profile.get(); // any member may read the clinic's public profile
  }

  @Patch()
  @RequirePermission('settings:write')
  update(@Body(new ZodBody(UpdateProfile)) body: z.infer<typeof UpdateProfile>) {
    return this.profile.update(body);
  }
}
