import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@dental/db';

export interface ActivityRow {
  id: string; created_at: Date; cursor_at: string; action: string; entity_type: string; entity_id: string | null; actor_type: string; actor_name: string | null;
  changes: Record<string, unknown> | null; ip: string | null; entity_label: string | null; patient_id: string | null;
}

/**
 * The clinic's audit_log, newest first (RLS: this clinic only). Each row names the record it is about where that is
 * cheap and useful: a patient's name and file number, an invoice's number, an appointment's patient, a member's name.
 */
@Injectable()
export class ActivityLogRepository {
  list(tx: Tx, q: { from: string; to: string; actor?: string; entityTypes: string[] | null; kind: 'all' | 'changes' | 'views'; after: { at: string; id: number } | null; limit: number }) {
    // The page first (on the clinic + time index, or clinic + actor + time), then the names of what those rows are
    // about (for those rows only). The clinic's time zone is an uncorrelated subquery, so the day bounds are constants
    // the planner turns into an index range.
    const zone = sql`(select coalesce(t.timezone, 'Africa/Cairo') from tenants t limit 1)`;
    return sql<ActivityRow>`
      with page as (
        select l.id, l.created_at, l.action, l.entity_type, l.entity_id, l.actor_type, l.actor_user_id, l.changes, l.ip
          from audit_log l
         where l.created_at >= (${q.from}::date::timestamp at time zone ${zone})
           and l.created_at < ((${q.to}::date + 1)::timestamp at time zone ${zone})
           and (${q.actor ?? null}::uuid is null or l.actor_user_id = ${q.actor ?? null}::uuid)
           and (${q.entityTypes}::text[] is null or l.entity_type = any(${q.entityTypes}::text[]))
           and (${q.kind} = 'all' or (${q.kind} = 'views') = (l.action like '%.view'))
           and (${q.after?.at ?? null}::timestamptz is null or (l.created_at, l.id) < (${q.after?.at ?? null}::timestamptz, ${q.after?.id ?? 0}::bigint))
         order by l.created_at desc, l.id desc
         limit ${q.limit})
      select l.id::text as id, l.created_at, to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at, l.action, l.entity_type, l.entity_id, l.actor_type, u.full_name as actor_name, l.changes,
             host(l.ip) as ip,
             case l.entity_type
               when 'patient' then (select p.full_name || ' · ' || p.file_no from patients p where p.id = l.entity_id)
               when 'patient_medical_history' then (select p.full_name || ' · ' || p.file_no from patients p where p.id = l.entity_id)
               when 'patient_chart' then (select p.full_name || ' · ' || p.file_no from patients p where p.id = l.entity_id)
               when 'patient_file' then (select p.full_name || ' · ' || p.file_no from patients p where p.id = l.entity_id)
               when 'invoice' then (select i.number from invoices i where i.id = l.entity_id)
               when 'appointment' then (select p.full_name from appointments a join patients p on p.id = a.patient_id where a.id = l.entity_id)
               when 'visit' then (select p.full_name from visits v join patients p on p.id = v.patient_id where v.id = l.entity_id)
               when 'member' then (select mu.full_name from tenant_members m join users mu on mu.id = m.user_id where m.id = l.entity_id)
               when 'doctor' then (select coalesce(d.name_ar, d.name_en) from doctors d where d.id = l.entity_id)
               when 'service' then (select coalesce(s.name_ar, s.name_en) from services s where s.id = l.entity_id)
               when 'branch' then (select coalesce(b.name_ar, b.name_en) from branches b where b.id = l.entity_id)
               when 'role' then (select r.name_ar from roles r where r.id = l.entity_id)
             end as entity_label,
             case
               when l.entity_type in ('patient', 'patient_medical_history', 'patient_chart', 'patient_file') then l.entity_id
               when l.entity_type = 'appointment' then (select a.patient_id from appointments a where a.id = l.entity_id)
               when l.entity_type = 'visit' then (select v.patient_id from visits v where v.id = l.entity_id)
               when l.entity_type = 'invoice' then (select i.patient_id from invoices i where i.id = l.entity_id)
             end as patient_id
        from page l left join users u on u.id = l.actor_user_id
       order by l.created_at desc, l.id desc`.execute(tx).then((r) => r.rows);
  }

  /** Who may appear in the log: the clinic's members, past and present (for the filter). */
  actors(tx: Tx) {
    return sql<{ user_id: string; name: string; status: string }>`
      select distinct on (m.user_id) m.user_id, u.full_name as name, m.status
        from tenant_members m join users u on u.id = m.user_id
       order by m.user_id, m.status = 'active' desc`.execute(tx).then((r) => r.rows.sort((a, b) => a.name.localeCompare(b.name, 'ar')));
  }

  /** The clinic's calendar day today (its time zone). */
  async today(tx: Tx): Promise<string> {
    const { rows } = await sql<{ d: string }>`select to_char(now() at time zone coalesce((select timezone from tenants limit 1), 'Africa/Cairo'), 'YYYY-MM-DD') as d`.execute(tx);
    return rows[0].d;
  }
}
