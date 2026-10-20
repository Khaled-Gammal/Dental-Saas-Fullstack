import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PlatformAuthController, PlatformController } from './platform.controllers';
import { PlatformRepository } from './platform.repository';
import { PlatformCookie, PlatformGuard } from './platform-session';
import { PlatformService } from './platform.service';

/**
 * The platform admin panel (H5; SRS ADM-01, ADM-02, ADM-04): every clinic with its plan and figures, trials,
 * suspension, plan changes, notes, and the plans themselves — for platform admins only. Clinic data is reached only
 * through the database's platform_*() functions, which return figures, never patient records.
 */
@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [PlatformAuthController, PlatformController],
  providers: [PlatformService, PlatformRepository, PlatformCookie, PlatformGuard],
})
export class PlatformModule {}
