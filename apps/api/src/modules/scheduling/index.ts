/** Public API of the scheduling module. Other modules import from here, never from its folders. */
export { SchedulingModule } from './scheduling.module';
export type { AppointmentStatus } from './domain/appointment-status';
export { canTransition, isFinal } from './domain/appointment-status';
export { computeSlots } from './domain/availability';
