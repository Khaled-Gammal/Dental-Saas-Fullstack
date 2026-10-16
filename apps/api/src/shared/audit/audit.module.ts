import { Global, Module } from '@nestjs/common';
import { AuditLog } from './audit-log';

/** Shared kernel (SRS 8.2): any module may write audit rows in its own transaction. */
@Global()
@Module({ providers: [AuditLog], exports: [AuditLog] })
export class AuditModule {}
