-- migrate:up
-- Schema v4 audit, PERF-01 (docs/database/schema-v3-audit.md): data_exports (0034) was created with the
-- "IS NOT DISTINCT FROM" form of the clinic policy, which cannot use an index. 0004 had already replaced that form on
-- every other table (51.6 ms -> 0.12 ms measured then). tenant_id is NOT NULL here, so "=" gives the same rows.
DROP POLICY tenant_isolation ON data_exports;
CREATE POLICY tenant_isolation ON data_exports
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- migrate:down
DROP POLICY tenant_isolation ON data_exports;
CREATE POLICY tenant_isolation ON data_exports
  USING (tenant_id IS NOT DISTINCT FROM current_tenant_id()) WITH CHECK (tenant_id IS NOT DISTINCT FROM current_tenant_id());
