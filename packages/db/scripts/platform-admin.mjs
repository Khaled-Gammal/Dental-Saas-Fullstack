// Makes an existing account a platform admin (H5), or takes it away. There is no screen for this on purpose: the
// platform panel controls every clinic, so only someone with database access names its admins.
// Usage: pnpm --filter @dental/db platform:admin <email>            give the role
//        pnpm --filter @dental/db platform:admin <email> --revoke   take it away
// The account must exist (sign up or be invited first) and have a verified email: the panel's sign-in emails a code.
import pg from 'pg';
import { need } from './env.mjs';

const email = process.argv[2];
const revoke = process.argv.includes('--revoke');
if (!email || !email.includes('@')) {
  console.error('Usage: platform:admin <email> [--revoke]');
  process.exit(1);
}
const client = new pg.Client({ connectionString: need('DATABASE_ADMIN_URL') });
await client.connect();
try {
  const { rows } = await client.query(
    `update users set platform_role = $2, updated_at = now() where lower(email::text) = lower($1)
     returning email, platform_role, email_verified_at is not null as verified`,
    [email, revoke ? null : 'super_admin'],
  );
  if (!rows.length) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }
  const u = rows[0];
  console.log(revoke ? `✓ ${u.email} is no longer a platform admin` : `✓ ${u.email} is a platform admin`);
  if (!revoke && !u.verified) console.warn('  Note: this email is not verified yet; the panel sign-in needs the emailed code.');
} finally {
  await client.end();
}
