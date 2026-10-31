-- migrate:up
-- Review R11: two tables without RLS that the API role could read in full, across every clinic.
-- * webhook_events (payment provider payloads): the API never touches it; the worker does.
-- * legal_acceptances: the API records acceptances and reads which document each person accepted (legal_pending(),
--   the panel's counts), never the IP address or browser they accepted from. Those two columns are now hidden.
--   INSERT ... ON CONFLICT DO NOTHING keeps working: it needs no SELECT on the hidden columns.
REVOKE ALL ON webhook_events FROM app_user;
REVOKE SELECT ON legal_acceptances FROM app_user;
GRANT SELECT (id, user_id, document_id, tenant_id, accepted_at) ON legal_acceptances TO app_user;

-- migrate:down
REVOKE SELECT (id, user_id, document_id, tenant_id, accepted_at) ON legal_acceptances FROM app_user;
GRANT SELECT ON legal_acceptances TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events TO app_user;
