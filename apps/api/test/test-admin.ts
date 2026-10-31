import { createDb, sql, type Db } from '@dental/db';
import { hashPassword } from '../src/modules/identity/crypto';

/** The worker's role on the database these tests use (the worker URL with the test database's name). */
export function workerUrl(): string {
  const target = new URL(process.env.DATABASE_URL!);
  const w = new URL(process.env.DATABASE_WORKER_URL!);
  w.pathname = target.pathname;
  return w.toString();
}

export interface TestAdmin {
  email: string;
  /** the worker connection, for a suite that also has to put seed data back */
  db: Db;
  /** deactivates the admin (so later runs' announcements do not mail it) and closes the connection */
  done: () => Promise<void>;
}

/**
 * A platform admin of the suite's own. Emailed sign-in codes are limited per address (3 in 10 minutes, always on), so
 * suites that shared the seed admin failed with 429 when the tests ran twice within 10 minutes. Named "Platform Admin"
 * like the seed one, which the suites check in authors and publishers.
 */
export async function createTestAdmin(suite: string, password: string): Promise<TestAdmin> {
  const db = createDb(workerUrl(), { max: 2, applicationName: 'dental-worker-test' });
  const email = `admin.${suite}.${Date.now().toString(36)}@demo.test`;
  await sql`insert into users (email, full_name, locale, email_verified_at, password_hash, platform_role)
            values (${email}, 'Platform Admin', 'ar', now(), ${await hashPassword(password)}, 'super_admin')`.execute(db);
  return {
    email, db,
    done: async () => {
      await sql`update users set is_active = false where email = ${email}`.execute(db);
      await db.destroy();
    },
  };
}
