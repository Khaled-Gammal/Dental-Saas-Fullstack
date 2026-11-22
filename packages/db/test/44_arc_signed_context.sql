-- ARC-01, phase ARC-1 (docs/database/arc-01-signed-tenant-context.md): the clinic context is believed only when the API
-- signed it. Run through dblink as a real app_user login: an admin session that only SET ROLEs to app_user is trusted on
-- purpose (it bypasses RLS anyway), so the proof is checked on a connection that logged in as the API. The admin
-- session computes the signatures here, as the API does with TENANT_CONTEXT_KEY.
\set ON_ERROR_STOP 1

-- test.enter_sql() / test.host_sql() (00_helpers.sql) sign as the API does.
-- one value from the app_user connection
CREATE OR REPLACE FUNCTION test.remote(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT v FROM dblink('arc', p_sql) AS t(v text)
$$;

SELECT test.ok((SELECT count(*) = 1 FROM app_context_keys WHERE id = 1) AND (SELECT mode = 'enforce' FROM app_context_settings),
  'the test database has the development key and enforces signed contexts (ARC-2, 0078)');

-- ---------- the key and the mode are out of the API role's reach ----------
BEGIN;
SET LOCAL ROLE app_user;
SELECT test.throws($$SELECT * FROM app_context_keys$$, 'permission denied', 'the API role cannot read the context key');
SELECT test.throws($$UPDATE app_context_settings SET mode = 'permissive'$$, 'permission denied', 'nor change the mode');
SELECT test.throws($$SELECT context_mac('\x00'::bytea, 'x')$$, 'permission denied', 'nor use the signing function');
ROLLBACK;

SELECT dblink_connect('arc', 'host=127.0.0.1 port=' || current_setting('port') || ' dbname=' || current_database() || ' user=app_user password=app_user_dev');

-- ---------- a signed context works, and nothing can be swapped inside it ----------
SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', test.enter_sql('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000000a2'));
SELECT test.ok(test.remote('SELECT current_tenant_id()::text') = '11111111-1111-1111-1111-111111111111', 'a signed context gives its clinic');
SELECT test.ok(test.remote('SELECT count(*)::text FROM patients') = (SELECT count(*)::text FROM patients WHERE tenant_id = '11111111-1111-1111-1111-111111111111'),
  'and exactly that clinic''s patients');
SELECT test.ok(test.remote('SELECT current_member_id()::text || ''/'' || current_user_id()::text || ''/'' || current_actor_type()')
  = 'c0000000-0000-0000-0000-0000000000a2/b0000000-0000-0000-0000-0000000000a2/member', 'with its member, user and actor');
SELECT test.ok(test.remote($$SELECT (set_config('app.tenant_id', resolve_tenant_by_host('clinic-b.lvh.me')::text, true) IS NOT NULL)::text$$) = 'true',
  'an injected set_config to clinic B (its id from its public hostname)');
SELECT test.ok(test.remote('SELECT coalesce(current_tenant_id()::text, ''none'')') = 'none', 'leaves no clinic at all');
SELECT test.ok(test.remote('SELECT count(*)::text FROM patients') = '0', 'so clinic B''s patients stay hidden');
SELECT test.ok(test.remote('SELECT count(*)::text FROM doctor_busy_intervals(ARRAY[''f0000000-0000-0000-0000-0000000000b1''::uuid], now() - interval ''10 years'', now() + interval ''10 years'')') = '0',
  'and definer functions see no clinic either');
SELECT dblink_exec('arc', 'ROLLBACK');

SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', test.enter_sql('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a4', 'b0000000-0000-0000-0000-0000000000a4'));
SELECT test.ok(test.remote('SELECT member_branch_ids()::text') = '{d0000000-0000-0000-0000-0000000000a2}', 'a branch-limited member keeps her branches');
SELECT dblink_exec('arc', $q$DO $x$ BEGIN PERFORM set_config('app.member_id', '', true); END $x$$q$);
SELECT test.ok(test.remote('SELECT coalesce(current_tenant_id()::text, ''none'')') = 'none', 'clearing the member to lift the branch limit drops the clinic');
SELECT dblink_exec('arc', 'ROLLBACK');

SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', test.enter_sql('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-0000000000a2'));
SELECT dblink_exec('arc', $q$DO $x$ BEGIN PERFORM set_config('app.member_id', 'c0000000-0000-0000-0000-0000000000a1', true); END $x$$q$);
SELECT test.ok(test.remote('SELECT coalesce(current_tenant_id()::text, ''none'')') = 'none', 'posing as the owner''s member drops the clinic');
SELECT dblink_exec('arc', 'ROLLBACK');

-- the proof is bound to its transaction: copied into the next one, it is worth nothing
SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', test.enter_sql('11111111-1111-1111-1111-111111111111', NULL, NULL, 'member'));
SELECT test.remote($$SELECT current_setting('app.ctx_proof')$$) AS proof \gset
SELECT dblink_exec('arc', 'COMMIT');
SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', format($f$DO $x$ BEGIN PERFORM set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true), set_config('app.member_id', '', true),
  set_config('app.user_id', '', true), set_config('app.actor_type', 'member', true), set_config('app.ctx_proof', %L, true); END $x$$f$, :'proof'));
SELECT test.ok(test.remote('SELECT coalesce(current_tenant_id()::text, ''none'')') = 'none', 'a proof replayed in another transaction is refused (in either mode)');
SELECT dblink_exec('arc', 'ROLLBACK');

-- ---------- bad signatures ----------
SELECT test.throws(format('SELECT dblink_exec(%L, %L)', 'arc',
  test.enter_sql('22222222-2222-2222-2222-222222222222', NULL, NULL, 'member', p_sig => repeat('0', 64))), 'signature not valid', 'a made-up signature is refused');
SELECT test.throws(format('SELECT dblink_exec(%L, %L)', 'arc',
  test.enter_sql('22222222-2222-2222-2222-222222222222', NULL, NULL, 'member', (extract(epoch FROM clock_timestamp()) * 1000)::bigint - 600000)),
  'expired', 'a signature from ten minutes ago is refused');
SELECT test.throws(format('SELECT dblink_exec(%L, %L)', 'arc',
  replace(test.enter_sql('11111111-1111-1111-1111-111111111111', NULL, NULL, 'member'), '11111111-1111-1111-1111-111111111111''::uuid', '22222222-2222-2222-2222-222222222222''::uuid')),
  'signature not valid', 'clinic A''s signature does not open clinic B');
INSERT INTO app_context_keys (id, key, retired_at) VALUES (2, convert_to('a retired key of at least thirty-two bytes', 'UTF8'), now());
SELECT test.throws(format('SELECT dblink_exec(%L, %L)', 'arc', test.enter_sql('11111111-1111-1111-1111-111111111111', p_key => 2::smallint)),
  'signature not valid', 'a retired key signs nothing');
DELETE FROM app_context_keys WHERE id = 2;
SELECT test.throws(format('SELECT dblink_exec(%L, %L)', 'arc', test.enter_sql('11111111-1111-1111-1111-111111111111', p_key => 9::smallint)),
  'signature not valid', 'nor does an unknown key');

-- ---------- the public website ----------
SELECT dblink_exec('arc', 'BEGIN');
SELECT test.ok(test.remote(test.host_sql('clinic-a.lvh.me')) = '11111111-1111-1111-1111-111111111111', 'a signed hostname enters its clinic');
SELECT test.ok(test.remote('SELECT current_actor_type() || ''/'' || coalesce(current_member_id()::text, ''-'')') = 'patient/-', 'as the patient, with no member');
SELECT test.ok(test.remote(test.host_sql('nowhere.lvh.me')) IS NULL, 'an unknown hostname enters nothing');
SELECT dblink_exec('arc', 'ROLLBACK');
SELECT test.throws(format('SELECT test.remote(%L)', test.host_sql('clinic-b.lvh.me', repeat('0', 64))), 'signature not valid', 'an unsigned hostname is refused');

-- ---------- the audit trail records the signed user ----------
SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', test.enter_sql('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1'));
SELECT dblink_exec('arc', $$UPDATE services SET price_minor = price_minor + 1 WHERE id = '90000000-0000-0000-0000-0000000000a1'$$);
SELECT test.ok(test.remote($$SELECT actor_user_id::text || '/' || actor_type FROM audit_log WHERE action = 'service.update' ORDER BY id DESC LIMIT 1$$)
  = 'b0000000-0000-0000-0000-0000000000a1/member', 'a change is audited with the signed user');
SELECT dblink_exec('arc', 'ROLLBACK');

-- ---------- enforce mode (the default since ARC-2, 0078): only a signed context counts ----------
SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', $q$DO $x$ BEGIN PERFORM set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true); END $x$$q$);
SELECT test.ok(test.remote('SELECT coalesce(current_tenant_id()::text, ''none'')') = 'none', 'enforce: the plain setting of the old API gives no clinic');
SELECT test.ok(test.remote('SELECT count(*)::text FROM patients') = '0', 'and no rows');
SELECT dblink_exec('arc', test.enter_sql('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000a1'));
SELECT test.ok(test.remote('SELECT current_tenant_id()::text') = '11111111-1111-1111-1111-111111111111', 'enforce: a signed context works as before');
SELECT test.ok(test.remote('SELECT (count(*) > 0)::text FROM patients') = 'true', 'with its rows');
SELECT dblink_exec('arc', 'ROLLBACK');
UPDATE app_context_settings SET mode = 'permissive', updated_at = now();

-- ---------- permissive mode (the rollout switch, and the emergency way back): the unsigned API keeps working ----------
SELECT dblink_exec('arc', 'BEGIN');
SELECT dblink_exec('arc', $q$DO $x$ BEGIN PERFORM set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true); END $x$$q$);
SELECT test.ok(test.remote('SELECT current_tenant_id()::text') = '11111111-1111-1111-1111-111111111111', 'permissive: an unsigned context is still accepted');
SELECT dblink_exec('arc', $q$DO $x$ BEGIN PERFORM set_config('app.ctx_proof', '1:' || repeat('a', 64), true); END $x$$q$);
SELECT test.ok(test.remote('SELECT coalesce(current_tenant_id()::text, ''none'')') = 'none', 'but never with a wrong proof');
SELECT dblink_exec('arc', 'ROLLBACK');

UPDATE app_context_settings SET mode = 'enforce', updated_at = now();
SELECT test.ok((SELECT mode = 'enforce' FROM app_context_settings), 'and the database is back to enforce');

SELECT dblink_disconnect('arc');

-- ---------- logins that bypass RLS keep the plain settings (migrations, seeds, the worker, these SQL tests) ----------
BEGIN;
SET LOCAL app.tenant_id = '22222222-2222-2222-2222-222222222222';
SET LOCAL ROLE app_user;
SELECT test.ok(current_tenant_id() = '22222222-2222-2222-2222-222222222222', 'an admin session acting as app_user is believed (it reads everything anyway)');
ROLLBACK;
