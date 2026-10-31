import { Injectable } from '@nestjs/common';
import type { Tx } from '@dental/db';
import { TenantDb } from '../../shared/database/tenant-db.service';
import { Err } from '../../shared/errors/app-error';
import { FaqsRepository, type FaqFields, type FaqRow } from './faqs.repository';
import type { EditFaqInput, NewFaqInput } from './faqs.schemas';
import { LiveSiteWrite } from './live-site';

/** A clinic keeps its questions short and few: a long list helps neither visitors nor search engines. */
export const MAX_FAQS = 50;
const notFound = () => Err.notFound('faq_not_found', 'Question not found');

const view = (r: FaqRow) => ({
  id: r.id, questionAr: r.question_ar, answerAr: r.answer_ar, questionEn: r.question_en, answerEn: r.answer_en, serviceId: r.service_id,
  isActive: r.is_active, sortOrder: r.sort_order, updatedAt: r.updated_at,
});

/**
 * Phase 2C-1: the clinic's questions and answers, shown on its website. Every change applies to the live site at once
 * (LiveSiteWrite purges the site's cache after the commit), like doctors and services.
 */
@Injectable()
export class FaqsService {
  constructor(private readonly db: TenantDb, private readonly live: LiveSiteWrite, private readonly repo: FaqsRepository) {}

  list() {
    return this.db.run(async (tx) => (await this.repo.list(tx)).map(view));
  }

  async create(input: NewFaqInput) {
    await this.live.run(async (tx, tenantId) => {
      await this.repo.lockClinic(tx); // two adds at once never pass the limit together nor share a position
      if ((await this.repo.count(tx)) >= MAX_FAQS) throw Err.conflict('faq_limit', `A clinic has ${MAX_FAQS} questions at most`);
      await this.assertService(tx, input.serviceId);
      await this.repo.create(tx, tenantId, {
        question_ar: input.questionAr, answer_ar: input.answerAr, question_en: input.questionEn, answer_en: input.answerEn,
        service_id: input.serviceId, ...(input.isActive !== undefined && { is_active: input.isActive }),
      });
    });
    return this.list();
  }

  async update(id: string, input: EditFaqInput) {
    const f: FaqFields = {
      ...(input.questionAr !== undefined && { question_ar: input.questionAr }),
      ...(input.answerAr !== undefined && { answer_ar: input.answerAr }),
      ...(input.questionEn !== undefined && { question_en: input.questionEn }),
      ...(input.answerEn !== undefined && { answer_en: input.answerEn }),
      ...(input.serviceId !== undefined && { service_id: input.serviceId }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
    };
    await this.live.run(async (tx) => {
      await this.assertService(tx, f.service_id);
      if (!(await this.repo.update(tx, id, f))) throw notFound();
    });
    return this.list();
  }

  async remove(id: string): Promise<void> {
    await this.live.run(async (tx) => {
      if (!(await this.repo.remove(tx, id))) throw notFound();
    });
  }

  /** Sets the whole order: the list must name every question exactly once. */
  async reorder(ids: string[]) {
    await this.live.run(async (tx) => {
      await this.repo.lockClinic(tx);
      const all = new Set(await this.repo.lockedIds(tx));
      if (all.size !== ids.length || ids.some((i) => !all.has(i))) {
        throw Err.badRequest('order_mismatch', 'The order must list every question exactly once; reload and try again');
      }
      await this.repo.reorder(tx, ids);
    });
    return this.list();
  }

  private async assertService(tx: Tx, serviceId: string | null | undefined) {
    if (serviceId && !(await this.repo.serviceExists(tx, serviceId))) throw Err.badRequest('service_not_found', 'Service not found');
  }
}
