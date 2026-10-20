import archiver from 'archiver';
import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { sql, type Db, type Tx } from '@dental/db';
import { DATA_POLICY } from '../config';
import type { EmailSender } from '../shared/notifications/ports';
import type { ObjectStorage } from '../shared/storage/ports';
import { CSV_BOM, csvLine, EXPORT_SKIP_TABLES, exportColumns, exportedFile, jsonRow, readme } from './export-format';

type Log = (o: object) => void;
interface ExportJob { id: string; tenant_id: string; requested_by: string; created_at: Date }
interface FileRow { id: string; kind: string; object_key: string; mime_type: string; variant_widths: number[] | null; size_bytes: string | number }

const exportKey = (tenantId: string, id: string) => `t/${tenantId}/exports/${id}.zip`;

/** Writes text to a file stream, waiting when its buffer is full (a big table never sits in memory). */
async function write(out: WriteStream, text: string): Promise<void> {
  if (!out.write(text)) await once(out, 'drain');
}
async function close(out: WriteStream): Promise<void> {
  out.end();
  await finished(out);
}

/**
 * Every table with the clinic's tenant_id (except the platform's and the system's), read in one consistent snapshot,
 * page by page, into `csv/<table>.csv` and `json/<table>.json` in `dir`. Plus `staff`: the clinic's people with their
 * role (from the shared accounts table, without passwords). Returns the row count per table and the files to add.
 */
async function writeTables(tx: Tx, tenantId: string, dir: string): Promise<{ tables: { name: string; rows: number }[]; files: FileRow[] }> {
  const { rows: cols } = await sql<{ table_name: string; column_name: string; data_type: string }>`
    select c.table_name, c.column_name, c.data_type from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id')
    order by c.table_name, c.ordinal_position`.execute(tx);
  const byTable = new Map<string, { name: string; type: string }[]>();
  for (const c of cols) {
    if (EXPORT_SKIP_TABLES.has(c.table_name)) continue;
    byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), { name: c.column_name, type: c.data_type }]);
  }

  const tables: { name: string; rows: number }[] = [];
  const dump = async (name: string, columns: string[], page: (offset: number) => Promise<Record<string, unknown>[]>) => {
    const csv = createWriteStream(path.join(dir, `${name}.csv`));
    const json = createWriteStream(path.join(dir, `${name}.json`));
    await write(csv, CSV_BOM + csvLine(columns));
    await write(json, '[');
    let count = 0;
    for (let offset = 0; ; offset += DATA_POLICY.pageRows) {
      const rows = await page(offset);
      for (const r of rows) {
        await write(csv, csvLine(columns.map((c) => r[c])));
        await write(json, `${count ? ',' : ''}\n${JSON.stringify(jsonRow(r, columns))}`);
        count += 1;
      }
      if (rows.length < DATA_POLICY.pageRows) break;
    }
    await write(json, '\n]\n');
    await Promise.all([close(csv), close(json)]);
    tables.push({ name, rows: count });
  };

  for (const [table, columns] of byTable) {
    const keep = exportColumns(columns);
    const list = sql.join(keep.map((c) => sql.ref(c)));
    // ctid: a stable order inside this snapshot, for every table whatever its key
    await dump(table, keep, async (offset) => (await sql<Record<string, unknown>>`
      select ${list} from ${sql.table(table)} where tenant_id = ${tenantId} order by ctid limit ${DATA_POLICY.pageRows} offset ${offset}`.execute(tx)).rows);
  }
  const staff = ['member_id', 'full_name', 'email', 'phone', 'role', 'status', 'joined_at', 'last_login_at'];
  await dump('staff', staff, async (offset) => (await sql<Record<string, unknown>>`
    select m.id as member_id, u.full_name, u.email, u.phone, coalesce(r.name_ar, r.key) as role, m.status, m.created_at as joined_at, u.last_login_at
    from tenant_members m join users u on u.id = m.user_id join roles r on r.id = m.role_id
    where m.tenant_id = ${tenantId} order by m.created_at limit ${DATA_POLICY.pageRows} offset ${offset}`.execute(tx)).rows);

  const { rows: files } = await sql<FileRow>`
    select id, kind, object_key, mime_type, variant_widths, size_bytes from files where tenant_id = ${tenantId} order by created_at`.execute(tx);
  return { tables, files };
}

/**
 * Builds one clinic's export into a ZIP on local disk, then stores it. Uploaded files are copied one at a time from
 * storage into the ZIP (each waits for the previous one), so memory stays small whatever the clinic's size.
 */
async function build(db: Db, storage: ObjectStorage, job: ExportJob): Promise<{ key: string; size: number; files: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dental-export-'));
  try {
    const tablesDir = path.join(dir, 'tables');
    await mkdir(tablesDir);
    const { clinic, tables, files } = await db.transaction().setIsolationLevel('repeatable read').execute(async (tx) => {
      await sql`set transaction read only`.execute(tx);
      const { rows } = await sql<{ name: string }>`select coalesce(name_ar, name_en, slug::text) as name from tenants where id = ${job.tenant_id}`.execute(tx);
      return { clinic: rows[0]?.name ?? '', ...(await writeTables(tx, job.tenant_id, tablesDir)) };
    });

    const zipPath = path.join(dir, 'export.zip');
    const out = createWriteStream(zipPath);
    const zip = archiver('zip', { zlib: { level: 6 } });
    const failed = new Promise<never>((_, reject) => { zip.on('error', reject); out.on('error', reject); });
    zip.pipe(out);

    // stored objects first, one by one: each 'entry' is the one just added (nothing else is queued yet)
    const index: unknown[][] = [];
    let missing = 0;
    for (const f of files) {
      const { key, path: name } = exportedFile(f);
      const obj = await storage.get(key);
      if (!obj) {
        missing += 1;
        index.push([f.id, f.kind, '', f.size_bytes, 'missing']);
        continue;
      }
      zip.append(obj.body, { name, store: true }); // images and PDFs are compressed already
      await Promise.race([once(zip, 'entry'), failed]);
      index.push([f.id, f.kind, name, f.size_bytes, '']);
    }
    zip.append(CSV_BOM + csvLine(['file_id', 'kind', 'path_in_zip', 'size_bytes', 'note']) + index.map(csvLine).join(''), { name: 'csv/files_index.csv' });
    for (const t of tables) {
      zip.file(path.join(tablesDir, `${t.name}.csv`), { name: `csv/${t.name}.csv` });
      zip.file(path.join(tablesDir, `${t.name}.json`), { name: `json/${t.name}.json` });
    }
    zip.append(readme(clinic, job.created_at, tables, files.length - missing, missing), { name: 'README.txt' });
    await Promise.race([zip.finalize(), failed]);
    await Promise.race([finished(out), failed]);

    const key = exportKey(job.tenant_id, job.id);
    await storage.putFile(key, zipPath, 'application/zip');
    return { key, size: (await stat(zipPath)).size, files: files.length - missing };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Every 30 s on its own queue: one queued export is built (an export cut off by a restart is marked failed first).
 * The owner who asked gets an email when it is ready; the download itself is from the dashboard.
 */
export async function buildNextExport(db: Db, storage: ObjectStorage, email: EmailSender, dashboardUrl: string, log: Log): Promise<string | null> {
  await sql`update data_exports set status = 'failed', error = 'interrupted', finished_at = now()
            where status = 'running' and started_at < now() - make_interval(mins => ${DATA_POLICY.staleExportMinutes})`.execute(db);
  const { rows } = await sql<ExportJob>`
    update data_exports set status = 'running', started_at = now()
    where id = (select id from data_exports where status = 'queued' order by created_at limit 1 for update skip locked)
    returning id, tenant_id, requested_by, created_at`.execute(db);
  const job = rows[0];
  if (!job) return null;
  try {
    const out = await build(db, storage, job);
    const { rows: done } = await sql<{ expires_at: Date }>`
      update data_exports set status = 'ready', object_key = ${out.key}, size_bytes = ${out.size}, files_count = ${out.files},
             finished_at = now(), expires_at = now() + make_interval(days => ${DATA_POLICY.exportKeepDays})
      where id = ${job.id} returning expires_at`.execute(db);
    log({ job: 'build-export', export: job.id, bytes: out.size, files: out.files });
    const { rows: who } = await sql<{ email: string | null }>`select email from users where id = ${job.requested_by}`.execute(db);
    if (who[0]?.email) {
      const until = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long', timeZone: 'Africa/Cairo' }).format(done[0].expires_at);
      await email.send(who[0].email, DATA_POLICY.readySubject,
        `نسخة بيانات عيادتك جاهزة للتنزيل حتى ${until}.\n\nنزّلها من لوحة العيادة (صفحة «بيانات العيادة»):\n${dashboardUrl}/#/data\n\nالملف يحتوي على بيانات طبية وشخصية للمرضى: احفظه في مكان آمن.`)
        .catch((e) => log({ job: 'build-export', export: job.id, email: 'failed', error: (e as Error).message }));
    }
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await sql`update data_exports set status = 'failed', error = ${message}, finished_at = now() where id = ${job.id}`.execute(db);
    log({ job: 'build-export', export: job.id, error: message });
  }
  return job.id;
}

/** Nightly: exports past their days are deleted from storage. */
export async function expireExports(db: Db, storage: ObjectStorage, log: Log): Promise<number> {
  const { rows } = await sql<{ id: string; object_key: string }>`
    select id, object_key from data_exports where status = 'ready' and expires_at <= now()`.execute(db);
  for (const r of rows) {
    try {
      await storage.deleteMany([r.object_key]);
      await sql`update data_exports set status = 'expired', object_key = null where id = ${r.id}`.execute(db);
    } catch (e) {
      log({ job: 'expire-exports', export: r.id, error: (e as Error).message });
    }
  }
  return rows.length;
}

/**
 * Nightly: clinics whose 90 days are over are erased: their stored objects first, then every row (purge_clinic). A
 * failure leaves the clinic for the next night; objects already deleted are not missed by anyone (it is closed).
 */
export async function purgeDeletedClinics(db: Db, storage: ObjectStorage, log: Log): Promise<number> {
  const { rows: due } = await sql<{ id: string }>`select c as id from clinics_due_for_purge() c`.execute(db);
  let purged = 0;
  for (const { id } of due) {
    try {
      const { rows: keys } = await sql<{ k: string }>`select k from clinic_object_keys(${id}) k`.execute(db);
      for (let i = 0; i < keys.length; i += 1000) await storage.deleteMany(keys.slice(i, i + 1000).map((r) => r.k));
      const { rows } = await sql<{ done: boolean }>`select purge_clinic(${id}) as done`.execute(db);
      if (rows[0]?.done) purged += 1;
      log({ job: 'purge-clinics', clinic: id, objects: keys.length, erased: rows[0]?.done ?? false });
    } catch (e) {
      log({ job: 'purge-clinics', clinic: id, error: (e as Error).message });
    }
  }
  return purged;
}
