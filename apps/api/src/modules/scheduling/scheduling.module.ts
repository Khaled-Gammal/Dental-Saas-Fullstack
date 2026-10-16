import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PatientsModule } from '../patients';
import { BookOnline } from './application/book-online.usecase';
import { GetAvailability } from './application/get-availability.usecase';
import { GetBookingOptions } from './application/get-booking-options.usecase';
import { HoldSlot } from './application/hold-slot.usecase';
import { ManageAppointments } from './application/manage-appointments.usecase';
import { BOOKING_CODES, CLOCK, HOLD_DETAILS, SCHEDULING_REPOSITORY } from './application/ports';
import { AppointmentsController } from './http/appointments.controller';
import { PublicBookingController } from './http/public-booking.controller';
import { HmacBookingCodes, RedisHoldDetailsStore, SystemClock } from './infrastructure/adapters';
import { KyselySchedulingRepository } from './infrastructure/kysely-scheduling.repository';

/**
 * Scheduling (SRS 8.2, hexagonal): `domain/` is pure TypeScript (slot engine, status machine, clinic time),
 * `application/` holds the use cases and the ports they need, `infrastructure/` binds the ports to Kysely, Redis
 * and HMAC codes, `http/` is the edge. Other modules reach appointments only through `index.ts`.
 */
@Module({
  imports: [IdentityModule, PatientsModule], // OtpService (the booking code); PatientDirectory (patients are owned by that module)
  controllers: [PublicBookingController, AppointmentsController],
  providers: [
    GetBookingOptions, GetAvailability, HoldSlot, BookOnline, ManageAppointments,
    { provide: SCHEDULING_REPOSITORY, useClass: KyselySchedulingRepository },
    { provide: HOLD_DETAILS, useClass: RedisHoldDetailsStore },
    { provide: CLOCK, useClass: SystemClock },
    { provide: BOOKING_CODES, useClass: HmacBookingCodes },
  ],
})
export class SchedulingModule {}
