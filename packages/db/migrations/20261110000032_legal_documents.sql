-- migrate:up
-- Phase H6 (NFR-15, owner 2026-10-20): the platform's Terms of Service, Privacy Policy and Data Processing Agreement,
-- versioned, and who accepted which version. The clinic owner accepts all three at sign-up (the DPA for that clinic);
-- invited staff accept Terms and Privacy when they join. A new version may require accepting again (the platform
-- admin decides when publishing); then those who accepted an older one accept it at their next sign-in.
-- The text comes from the owner (or their lawyer) and is published from the platform panel; nothing here writes it.

CREATE TABLE legal_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                  text NOT NULL CONSTRAINT legal_documents_kind CHECK (kind IN ('terms', 'privacy', 'dpa')),
  version               int  NOT NULL CHECK (version > 0),
  title_ar              text NOT NULL CONSTRAINT legal_documents_title CHECK (char_length(btrim(title_ar)) BETWEEN 2 AND 200),
  body_ar               text NOT NULL CONSTRAINT legal_documents_body CHECK (char_length(btrim(body_ar)) BETWEEN 20 AND 200000),
  requires_reacceptance boolean NOT NULL DEFAULT false,
  published_at          timestamptz NOT NULL DEFAULT now(),
  published_by          uuid REFERENCES users(id),
  UNIQUE (kind, version)
);

-- one row per acceptance, never changed: the DPA is accepted for a clinic (tenant_id), Terms and Privacy by a person
CREATE TABLE legal_acceptances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES legal_documents(id),
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  ip           inet,
  user_agent   text CHECK (char_length(user_agent) <= 300),
  CONSTRAINT legal_acceptances_once UNIQUE NULLS NOT DISTINCT (user_id, document_id, tenant_id)
);
CREATE INDEX legal_acceptances_user ON legal_acceptances (user_id);

-- documents are published by the platform panel only (as plans since 0004); acceptances are recorded, never changed
REVOKE INSERT, UPDATE, DELETE ON legal_documents FROM app_user, app_worker;
REVOKE UPDATE, DELETE ON legal_acceptances FROM app_user, app_worker;
GRANT SELECT, INSERT ON legal_documents TO app_definer;

-- What a person still has to accept to use a clinic: per kind that applies to them (owner: terms, privacy, dpa;
-- staff: terms, privacy) the latest version, when they never accepted that kind (the DPA: for this clinic) or a newer
-- version than the one they accepted asks to be accepted again.
CREATE OR REPLACE FUNCTION legal_pending(p_user uuid, p_tenant uuid, p_owner boolean)
RETURNS TABLE (id uuid, kind text, version int, title_ar text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH kinds AS (
    SELECT k FROM unnest(CASE WHEN p_owner THEN ARRAY['terms', 'privacy', 'dpa'] ELSE ARRAY['terms', 'privacy'] END) k),
  latest AS (
    SELECT DISTINCT ON (d.kind) d.id, d.kind, d.version, d.title_ar FROM legal_documents d JOIN kinds ON kinds.k = d.kind
    ORDER BY d.kind, d.version DESC),
  accepted AS (
    SELECT d.kind, max(d.version) AS version FROM legal_acceptances a JOIN legal_documents d ON d.id = a.document_id
    WHERE a.user_id = p_user AND (d.kind <> 'dpa' OR a.tenant_id = p_tenant)
    GROUP BY d.kind)
  SELECT l.id, l.kind, l.version, l.title_ar FROM latest l LEFT JOIN accepted acc ON acc.kind = l.kind
  WHERE acc.version IS NULL
     OR EXISTS (SELECT 1 FROM legal_documents n WHERE n.kind = l.kind AND n.version > acc.version AND n.requires_reacceptance)
  ORDER BY array_position(ARRAY['terms', 'privacy', 'dpa'], l.kind)
$$;

-- The panel publishes a new version (the next number for its kind); the platform audit log names who did it.
CREATE OR REPLACE FUNCTION platform_publish_legal(p_actor uuid, p_kind text, p_title text, p_body text, p_reaccept boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_version int;
BEGIN
  PERFORM platform_assert_admin(p_actor);
  PERFORM pg_advisory_xact_lock(hashtext('legal_documents'), hashtext(p_kind));
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM legal_documents WHERE kind = p_kind;
  INSERT INTO legal_documents (kind, version, title_ar, body_ar, requires_reacceptance, published_by)
  VALUES (p_kind, v_version, btrim(p_title), btrim(p_body), coalesce(p_reaccept, false), p_actor) RETURNING id INTO v_id;
  INSERT INTO platform_audit_log (actor_user_id, action, details)
  VALUES (p_actor, 'legal.published', jsonb_build_object('kind', p_kind, 'version', v_version, 'requires_reacceptance', coalesce(p_reaccept, false)));
  RETURN v_id;
END $$;
ALTER FUNCTION platform_publish_legal(uuid, text, text, text, boolean) OWNER TO app_definer;
REVOKE EXECUTE ON FUNCTION platform_publish_legal(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_publish_legal(uuid, text, text, text, boolean) TO app_user;

-- migrate:down
DROP FUNCTION IF EXISTS platform_publish_legal(uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS legal_pending(uuid, uuid, boolean);
DROP TABLE IF EXISTS legal_acceptances;
DROP TABLE IF EXISTS legal_documents;
