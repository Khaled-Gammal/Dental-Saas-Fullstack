import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHmac, randomInt } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../../config';
import { REDIS } from '../../../shared/redis/tokens';
import type { BookingCodes, Clock, HoldDetails, HoldDetailsStore } from '../application/ports';

/** Real time; tests may provide a fixed one. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}

/** Visitor details live in Redis for the life of the hold: nothing half-booked ever reaches the database. */
@Injectable()
export class RedisHoldDetailsStore implements HoldDetailsStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  private key(holdId: string) { return `hold:${holdId}`; }

  async put(holdId: string, d: HoldDetails, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(holdId), JSON.stringify(d), 'EX', ttlSeconds);
  }

  async get(holdId: string): Promise<HoldDetails | null> {
    const raw = await this.redis.get(this.key(holdId));
    return raw ? (JSON.parse(raw) as HoldDetails) : null;
  }

  async delete(holdId: string): Promise<void> {
    await this.redis.del(this.key(holdId));
  }
}

/** 6-digit reception codes, keyed per clinic so the same digits at two clinics hash differently. */
@Injectable()
export class HmacBookingCodes implements BookingCodes {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  issue(tenantId: string): { code: string; hash: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    return { code, hash: this.hash(tenantId, code) };
  }

  hash(tenantId: string, code: string): string {
    return createHmac('sha256', this.cfg.BOOKING_CODE_SECRET).update(`${tenantId}:${code}`).digest('hex');
  }
}
