import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Tx } from '@dental/db';
import { hasPermission } from '../../auth/permissions';
import { APP_CONFIG, EXPENSE_FILE_POLICY, type AppConfig } from '../../config';
import { AuditLog } from '../../shared/audit/audit-log';
import type { RequestContext } from '../../shared/context/request-context';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { PlanLimits } from '../../shared/plans/plan-limits.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../shared/storage/ports';
import { sniff } from '../../shared/storage/private-files';
import { dateInZone, safeTimeZone } from '../../shared/time/clinic-time';
import { EXPENSE_FILE_SIGNER, ExpenseFileSigner, expenseKey } from './expense-files';
import { canAttachDocument, canVoid, expenseEntry } from './finance-rules';
import type { ExpensesQueryInput, NewExpenseInput } from './finance.schemas';
import { FinanceRepository } from './finance.repository';

const notFound = () => Err.notFound('expense_not_found', 'Expense not found');
const linkExpired = () => Err.forbidden('link_expired', 'This link expired or is not valid');
const ENTRY_ERRORS = {
  missing_permission: () => Err.forbidden('missing_permission', 'Missing permission: expenses:write'),
  cash_only: () => Err.forbidden('cash_only', 'Reception records cash expenses only'),
  over_reception_limit: (limit: number) => Err.badRequest('over_reception_limit', 'The amount is more than reception may record', { limit }),
};

/**
 * Expenses (SRS EXP-001…004, CLR-03). The database refuses a future date, an edit of a recorded expense, a status
 * moving backwards, self-approval and anything that changes a closed cash day; this service decides the entry
 * status from the caller's rights and checks who approves and voids. The supporting document (H2) is private: PDF or
 * image checked by its bytes, opened through 5-minute links bound to the member, attached once and never replaced.
 */
@Injectable()
export class ExpensesService {
  private readonly logger = new Logger('ExpenseFiles');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(EXPENSE_FILE_SIGNER) private readonly signer: ExpenseFileSigner,
    private readonly db: TenantDb,
    private readonly repo: FinanceRepository,
    private readonly audit: AuditLog,
    private readonly plan: PlanLimits,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private can(p: string) { return hasPermission(this.cls.get('permissions'), p); }
  private rights() { return { full: this.can('expenses:write'), cash: this.can('expenses:write:cash') }; }
  private member(): string {
    const m = this.cls.get('memberId');
    if (!m) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    return m;
  }

  /** expenses:read sees every expense of their branches; reception sees the ones it recorded. */
  list(q: ExpensesQueryInput) {
    const all = this.can('expenses:read');
    if (!all && !this.can('expenses:write:cash')) throw Err.forbidden('missing_permission', 'Missing permission: expenses:read');
    return this.db.run(async (tx, tenantId) => {
      const items = await this.repo.list(tx, { ...q, ...(!all && { createdBy: this.member() }) });
      return { items: items.map((e) => this.withDocument(tenantId, e)), byCategory: all ? await this.repo.byCategory(tx, q) : null };
    });
  }

  get(id: string) {
    return this.db.run((tx) => this.view(tx, id));
  }

  create(input: NewExpenseInput) {
    return this.db.run(async (tx, tenantId) => {
      const clinic = await this.repo.clinic(tx, tenantId);
      const entry = expenseEntry(this.rights(), input, clinic.reception_expense_limit_minor);
      if ('error' in entry) throw entry.error === 'over_reception_limit' ? ENTRY_ERRORS.over_reception_limit(clinic.reception_expense_limit_minor) : ENTRY_ERRORS[entry.error]();
      if (!(await this.repo.branch(tx, input.branchId))) throw Err.badRequest('branch_not_found', 'Branch not found');
      const category = await this.repo.category(tx, input.categoryId);
      if (!category) throw Err.badRequest('category_not_found', 'Category not found');
      if (!category.is_active) throw Err.badRequest('category_inactive', 'This category is no longer used');
      const { id } = await this.repo.add(tx, tenantId, {
        branchId: input.branchId, categoryId: input.categoryId, amountMinor: input.amountMinor, currency: clinic.currency, method: input.method,
        spentOn: input.spentOn ?? dateInZone(Date.now(), safeTimeZone(clinic.timezone)), reference: input.reference ?? null,
        supplierName: input.supplierName ?? null, description: input.description ?? null, status: entry.status, createdBy: this.member(),
      });
      return this.view(tx, id);
    });
  }

  /** EXP-003: pending only, decided by someone else (the database refuses self-approval too). */
  decide(id: string, approve: boolean, note: string | null) {
    return this.db.run(async (tx, tenantId) => {
      const e = await this.repo.lock(tx, id);
      if (!e) throw notFound();
      if (e.status !== 'pending') throw Err.conflict('expense_not_pending', 'This expense is not waiting for approval');
      if (e.created_by === this.member()) throw Err.forbidden('self_approval', 'An expense is approved by someone else');
      await this.repo.decide(tx, id, { status: approve ? 'approved' : 'rejected', by: this.member(), note });
      await this.audit.record(tx, tenantId, { action: approve ? 'expense.approved' : 'expense.rejected', entityType: 'expense', entityId: id, changes: { note: !!note } });
      return this.view(tx, id);
    });
  }

  pending() {
    return this.db.run(async (tx, tenantId) => (await this.repo.list(tx, { status: 'pending', limit: 200 })).map((e) => this.withDocument(tenantId, e)));
  }

  // ---------- the supporting document (EXP-001, H2) ----------
  /** One PDF or image, attached when the expense is recorded or later, once (canAttachDocument; the database checks it too). */
  async attachDocument(id: string, buf: Buffer) {
    if (!this.can('expenses:write') && !this.can('expenses:write:cash')) throw ENTRY_ERRORS.missing_permission();
    if (!buf.length) throw Err.badRequest('file_required', 'Choose a file to upload');
    const type = sniff(buf);
    if (!type) throw Err.badRequest('unsupported_file_type', 'Upload a PDF, JPEG, PNG or WebP file');
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) throw Err.forbidden('no_clinic', 'No clinic selected for this request');
    await this.db.run((tx) => this.attachable(tx, id)); // refuse early, before anything is stored
    const fileId = randomUUID();
    const key = expenseKey(tenantId, fileId);
    await this.storage.put(key, buf, type.mime); // object first, row second: a row never points at a missing object
    try {
      return await this.db.run(async (tx) => {
        await this.attachable(tx, id);
        await this.plan.assertStorage(tx, tenantId, buf.length, () => this.repo.usedBytes(tx));
        await this.repo.attachDocument(tx, id, {
          id: fileId, tenantId, bucket: this.cfg.STORAGE_DRIVER === 's3' ? this.cfg.S3_BUCKET : 'local', objectKey: key, mime: type.mime, size: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'), uploadedBy: this.member(),
        });
        await this.audit.record(tx, tenantId, { action: 'expense.document_attached', entityType: 'expense', entityId: id, changes: { file_id: fileId } });
        return this.view(tx, id);
      });
    } catch (e) {
      await this.storage.deleteMany([key]).catch((err) => this.logger.error(`orphaned object ${key}: ${(err as Error).message}`));
      throw e;
    }
  }

  /** The signed link: no session, the signature is the permission (bound to the member, 5 minutes). */
  async openDocument(tenantId: string, fileId: string, userId: string, exp: number, sig: string): Promise<{ body: Readable; length: number; mime: string; name: string }> {
    if (!this.signer.verify(tenantId, fileId, userId, exp, sig)) throw linkExpired();
    const f = await this.db.runAs(tenantId, (tx) => this.repo.documentOf(tx, fileId), { userId, actorType: 'member' });
    if (!f) throw Err.notFound('file_not_found', 'File not found');
    const obj = await this.storage.get(f.object_key);
    if (!obj) throw Err.notFound('file_not_found', 'File not found');
    const ext = f.mime_type === 'application/pdf' ? 'pdf' : f.mime_type.split('/')[1];
    return { body: obj.body, length: obj.length, mime: f.mime_type, name: `expense-${f.expense_id.slice(0, 8)}.${ext}` };
  }

  private async attachable(tx: Tx, id: string) {
    const e = await this.repo.lock(tx, id);
    if (!e || (!this.can('expenses:read') && e.created_by !== this.member())) throw notFound();
    if (e.file_id) throw Err.conflict('expense_has_document', 'This expense already has its document');
    if (e.status === 'void') throw Err.conflict('expense_void', 'This expense is already void');
    if (!canAttachDocument(this.rights(), e, this.member())) throw ENTRY_ERRORS.missing_permission();
  }

  private withDocument<E extends { file_id: string | null; document_mime: string | null; document_size: number | null }>(tenantId: string, e: E) {
    const { document_mime, document_size, ...rest } = e;
    return {
      ...rest,
      document: e.file_id && document_mime
        ? { url: this.signer.url(tenantId, e.file_id, this.cls.get('userId')!, EXPENSE_FILE_POLICY.linkSeconds), mime_type: document_mime, size_bytes: document_size ?? 0 }
        : null,
    };
  }

  /** EXP-004: corrections are a void with a reason plus a new expense; the voided one stays visible. */
  void(id: string, reason: string) {
    return this.db.run(async (tx, tenantId) => {
      const e = await this.repo.lock(tx, id);
      if (!e || (!this.can('expenses:read') && e.created_by !== this.member())) throw notFound();
      if (e.status === 'void') throw Err.conflict('expense_void', 'This expense is already void');
      if (!canVoid(this.rights(), e, this.member())) throw Err.forbidden('missing_permission', 'Missing permission: expenses:write');
      await this.repo.void(tx, id, this.member(), reason);
      await this.audit.record(tx, tenantId, { action: 'expense.voided', entityType: 'expense', entityId: id, changes: { reason: true } });
      return this.view(tx, id);
    });
  }

  // ---------- categories (EXP-002) ----------
  categories() {
    if (!['expenses:read', 'expenses:write', 'expenses:write:cash'].some((p) => this.can(p))) throw Err.forbidden('missing_permission', 'Missing permission: expenses:read');
    return this.db.run((tx) => this.repo.categories(tx));
  }

  addCategory(name: string) {
    return this.db.run(async (tx, tenantId) => {
      await this.repo.addCategory(tx, tenantId, name);
      return this.repo.categories(tx);
    });
  }

  /** renamed or deactivated; a category is never deleted, so past expenses keep theirs */
  editCategory(id: string, patch: { name?: string; isActive?: boolean }) {
    return this.db.run(async (tx) => {
      if (!(await this.repo.editCategory(tx, id, patch))) throw Err.notFound('category_not_found', 'Category not found');
      return this.repo.categories(tx);
    });
  }

  // ---------- the reception limit (CLR-03) ----------
  settings() {
    return this.db.run(async (tx, tenantId) => ({ receptionLimitMinor: (await this.repo.clinic(tx, tenantId)).reception_expense_limit_minor }));
  }

  setSettings(receptionLimitMinor: number) {
    return this.db.run(async (tx, tenantId) => {
      await this.repo.setReceptionLimit(tx, tenantId, receptionLimitMinor);
      return { receptionLimitMinor };
    });
  }

  private async view(tx: Tx, id: string) {
    const e = await this.repo.get(tx, id);
    if (!e) throw notFound();
    if (!this.can('expenses:read') && e.created_by !== this.member()) throw notFound();
    const me = this.member();
    return {
      ...this.withDocument(this.cls.get('tenantId')!, e),
      can: {
        decide: e.status === 'pending' && this.can('expenses:approve') && e.created_by !== me,
        void: canVoid(this.rights(), e, me),
        attach: canAttachDocument(this.rights(), e, me),
      },
    };
  }
}
