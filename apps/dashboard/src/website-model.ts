import type { Faq, MediaImage, WebsiteSection, WebsiteSectionKey, WebsiteStatus } from './types';

/**
 * Phase 2C-1: the website page's pure parts — the sections' names, moving a section up or down, and the question
 * form's checks (the same limits as the API). Unit-tested.
 */
export const SECTION_LABEL: Record<WebsiteSectionKey, { title: string; hint: string }> = {
  services: { title: 'الخدمات والأسعار', hint: 'الخدمات المعروضة على الموقع بأسعارها ومدتها' },
  doctors: { title: 'الأطباء', hint: 'الأطباء المعروضون على الموقع' },
  gallery: { title: 'المعرض', hint: 'حالات قبل وبعد والصور المنشورة من صفحة معرض الصور' },
  faq: { title: 'الأسئلة الشائعة', hint: 'الأسئلة المفعّلة أدناه' },
  branches: { title: 'الفروع والمواعيد', hint: 'الفروع ومواعيد العمل وحالة الفرع الآن' },
};

/** The list with one section moved one place up (-1) or down (1); unchanged at either end. */
export function moveSection(list: readonly WebsiteSection[], key: WebsiteSectionKey, dir: -1 | 1): WebsiteSection[] {
  const i = list.findIndex((s) => s.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const sameSections = (a: readonly WebsiteSection[], b: readonly WebsiteSection[]) =>
  a.length === b.length && a.every((s, i) => s.key === b[i].key && s.visible === b[i].visible);

export interface FaqForm { questionAr: string; answerAr: string; serviceId: string; isActive: boolean }
export const emptyFaq: FaqForm = { questionAr: '', answerAr: '', serviceId: '', isActive: true };
export const toFaqForm = (f: Faq): FaqForm => ({ questionAr: f.questionAr, answerAr: f.answerAr, serviceId: f.serviceId ?? '', isActive: f.isActive });

export type FaqProblem = 'question_short' | 'question_long' | 'answer_short' | 'answer_long';
/** What stops the form from saving (counted after trimming, as the API does). */
export function faqProblems(f: FaqForm): FaqProblem[] {
  const q = f.questionAr.trim().length;
  const a = f.answerAr.trim().length;
  return [
    ...(q < 5 ? ['question_short' as const] : q > 300 ? ['question_long' as const] : []),
    ...(a < 2 ? ['answer_short' as const] : a > 3000 ? ['answer_long' as const] : []),
  ];
}

/** The request body: everything for a new question; only what changed for an edit. */
export function faqBody(f: FaqForm, orig: FaqForm | null): Record<string, unknown> {
  const full = { questionAr: f.questionAr.trim(), answerAr: f.answerAr.trim(), serviceId: f.serviceId || null, isActive: f.isActive };
  if (!orig) return full;
  const was = { questionAr: orig.questionAr.trim(), answerAr: orig.answerAr.trim(), serviceId: orig.serviceId || null, isActive: orig.isActive };
  return Object.fromEntries(Object.entries(full).filter(([k, v]) => was[k as keyof typeof was] !== v));
}

// ---------- Phase 2C-3: search results and sharing ----------
export const SEO_LIMITS = { title: { min: 5, max: 70, best: 60 }, description: { min: 20, max: 200, best: 160 } } as const;
export interface SeoForm { title: string; description: string; shareImage: MediaImage | null }
export const toSeoForm = (s: WebsiteStatus['seo']): SeoForm => ({ title: s.title ?? '', description: s.description ?? '', shareImage: s.shareImage });

export type SeoProblem = 'title_short' | 'title_long' | 'description_short' | 'description_long';
/** Empty fields are fine (the site uses its defaults); filled ones must fit the limits (counted after trimming). */
export function seoProblems(f: SeoForm): SeoProblem[] {
  const t = f.title.trim().length, d = f.description.trim().length;
  return [
    ...(t > 0 && t < SEO_LIMITS.title.min ? ['title_short' as const] : t > SEO_LIMITS.title.max ? ['title_long' as const] : []),
    ...(d > 0 && d < SEO_LIMITS.description.min ? ['description_short' as const] : d > SEO_LIMITS.description.max ? ['description_long' as const] : []),
  ];
}

/** Only what changed; emptied text becomes null (back to the default). */
export function seoBody(f: SeoForm, orig: SeoForm): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (f.title.trim() !== orig.title.trim()) body.title = f.title.trim() || null;
  if (f.description.trim() !== orig.description.trim()) body.description = f.description.trim() || null;
  if ((f.shareImage?.id ?? null) !== (orig.shareImage?.id ?? null)) body.shareFileId = f.shareImage?.id ?? null;
  return body;
}

/** What the search result shows: the clinic's text, or the site's default, cut where Google usually cuts it. */
export function searchPreview(f: SeoForm, clinicName: string, about: string | null): { title: string; description: string } {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const title = f.title.trim() || `${clinicName} | عيادة أسنان`;
  const description = f.description.trim() || about?.trim() || `احجز موعدك في ${clinicName}: خدمات أسنان بأسعار واضحة، أطباء متخصصون ومواعيد عمل محدّثة.`;
  return { title: cut(title, SEO_LIMITS.title.best), description: cut(description.replace(/\s+/g, ' '), SEO_LIMITS.description.best) };
}
