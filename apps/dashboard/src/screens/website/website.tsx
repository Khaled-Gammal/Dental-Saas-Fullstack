import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { Choice } from '../../components/choice';
import { ImageField } from '../../components/image-field';
import { moveId } from '../../gallery-model';
import { faqApi, useFaqMutation, useFaqs, useProfile, useServices, useSetSections, useSetSeo, useWebsite } from '../../queries';
import type { Faq, WebsiteSection, WebsiteStatus } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Skeleton, Switch, TextArea } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { ChevronIcon, EditIcon, PlusIcon } from '../../ui/icons';
import { emptyFaq, faqBody, faqProblems, moveSection, sameSections, searchPreview, SECTION_LABEL, SEO_LIMITS, seoBody, seoProblems, toFaqForm, toSeoForm, type FaqForm, type SeoForm } from '../../website-model';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * `#/website` (Phase 2C-1, 2C-3): the order of the clinic website's sections and which are shown, its questions and
 * answers, and how it shows in search results and when shared. All apply to the live site at once (no publishing step).
 */
export function WebsitePage({ clinicId }: { clinicId: string }) {
  return (
    <>
      <PageHeader title="الموقع" sub="ترتيب أقسام موقع عيادتك، والأسئلة الشائعة، وظهوره في جوجل وعند المشاركة. أي تغيير هنا يظهر على الموقع فورًا." />
      <div className="website-page">
        <SectionsCard clinicId={clinicId} />
        <FaqsCard clinicId={clinicId} />
        <SeoCard clinicId={clinicId} />
      </div>
    </>
  );
}

function SectionsCard({ clinicId }: { clinicId: string }) {
  const site = useWebsite(clinicId);
  const save = useSetSections(clinicId);
  const [draft, setDraft] = useState<WebsiteSection[] | null>(null); // null = as saved
  if (site.isError) return <Card><h2>أقسام الموقع</h2><ErrorText error={site.error} onRetry={() => void site.refetch()} /></Card>;
  if (!site.data) return <Card><h2>أقسام الموقع</h2><Skeleton h={56} count={5} /></Card>;
  const saved = site.data.sections;
  const list = draft ?? saved;
  const changed = draft !== null && !sameSections(draft, saved);
  const set = (next: WebsiteSection[]) => { save.reset(); setDraft(next); };
  return (
    <Card>
      <h2>أقسام الموقع</h2>
      <p className="muted small">الغلاف في أعلى الصفحة وزر الحجز في آخرها ثابتان. القسم الفارغ (بلا خدمات أو صور أو أسئلة) لا يظهر حتى لو كان مفعّلًا.</p>
      <ol className="ws-sections mt-sm">
        {list.map((s, i) => (
          <li key={s.key} className={s.visible ? undefined : 'is-hidden'}>
            <span className="ws-pos" aria-hidden>{i + 1}</span>
            <div className="ws-text"><strong>{SECTION_LABEL[s.key].title}</strong><span className="muted small">{SECTION_LABEL[s.key].hint}</span></div>
            <Switch checked={s.visible} label="ظاهر" ariaLabel={`إظهار قسم ${SECTION_LABEL[s.key].title}`} onChange={(v) => set(list.map((x) => (x.key === s.key ? { ...x, visible: v } : x)))} />
            <div className="ws-move">
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => set(moveSection(list, s.key, -1))} aria-label={`تقديم ${SECTION_LABEL[s.key].title}`}><ChevronIcon size={16} className="rot-up" /></button>
              <button type="button" className="icon-btn" disabled={i === list.length - 1} onClick={() => set(moveSection(list, s.key, 1))} aria-label={`تأخير ${SECTION_LABEL[s.key].title}`}><ChevronIcon size={16} className="rot-down" /></button>
            </div>
          </li>
        ))}
      </ol>
      <ErrorText error={save.error} />
      {save.isSuccess && !changed && <Alert tone="success">تم الحفظ، والموقع يعرض الترتيب الجديد.</Alert>}
      <div className="row-end mt-sm">
        {changed && <Button variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>تراجع</Button>}
        <Button disabled={!changed} loading={save.isPending} onClick={() => save.mutate(list, { onSuccess: () => setDraft(null) })}>حفظ الترتيب</Button>
      </div>
    </Card>
  );
}

function FaqsCard({ clinicId }: { clinicId: string }) {
  const faqs = useFaqs(clinicId);
  const [editing, setEditing] = useState<Faq | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Faq | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toggle = useFaqMutation(clinicId, ({ id, isActive }: { id: string; isActive: boolean }) => faqApi.update(id, { isActive }));
  const reorder = useFaqMutation(clinicId, (ids: string[]) => faqApi.reorder(ids));
  const remove = useFaqMutation(clinicId, (id: string) => faqApi.remove(id));
  const act = <V,>(m: { mutate: (v: V, o?: { onError?: (e: unknown) => void }) => void }, v: V) => { setError(null); m.mutate(v, { onError: setError }); };
  const items = faqs.data ?? [];
  // one change at a time: each answer replaces the whole list, so a slower earlier answer must not overwrite a later one
  const busy = toggle.isPending || reorder.isPending || remove.isPending;
  const add = <Button onClick={() => setEditing('new')} disabled={items.length >= 50}><PlusIcon size={18} />إضافة سؤال</Button>;
  return (
    <Card>
      <div className="ws-head">
        <div><h2>الأسئلة الشائعة</h2><p className="muted small">أسئلة المرضى المتكررة بإجاباتها: التأمين، الأسعار، المواقف، مدة العلاج… تظهر على الموقع وفي نتائج البحث.</p></div>
        {items.length > 0 && add}
      </div>
      <ErrorText error={error} />
      {faqs.isError ? <ErrorText error={faqs.error} onRetry={() => void faqs.refetch()} />
        : faqs.isLoading ? <Skeleton h={64} count={3} />
          : items.length === 0 ? <EmptyState icon={<PlusIcon size={28} />} title="لا توجد أسئلة بعد" text="أضف أول سؤال يسأله مرضاك كثيرًا، مع إجابة قصيرة وواضحة." action={add} />
            : (
              <ul className="ws-faqs mt-sm" aria-busy={busy || undefined}>
                {items.map((f, i) => (
                  <li key={f.id} className={f.isActive ? undefined : 'is-hidden'}>
                    <div className="ws-text">
                      <strong><bdi>{f.questionAr}</bdi> {!f.isActive && <Badge>مخفي</Badge>}</strong>
                      <span className="muted small ws-answer"><bdi>{f.answerAr}</bdi></span>
                    </div>
                    <div className="ws-faq-actions">
                      <Switch checked={f.isActive} label="ظاهر" ariaLabel={`إظهار السؤال: ${f.questionAr}`} disabled={busy} onChange={(v) => act(toggle, { id: f.id, isActive: v })} />
                      <button type="button" className="icon-btn" disabled={i === 0 || busy} onClick={() => act(reorder, moveId(items.map((x) => x.id), f.id, -1))} aria-label={`تقديم السؤال: ${f.questionAr}`}><ChevronIcon size={16} className="rot-up" /></button>
                      <button type="button" className="icon-btn" disabled={i === items.length - 1 || busy} onClick={() => act(reorder, moveId(items.map((x) => x.id), f.id, 1))} aria-label={`تأخير السؤال: ${f.questionAr}`}><ChevronIcon size={16} className="rot-down" /></button>
                      <Button variant="ghost" onClick={() => setEditing(f)} aria-label={`تعديل السؤال: ${f.questionAr}`}><EditIcon size={16} />تعديل</Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setDeleting(f)} aria-label={`حذف السؤال: ${f.questionAr}`}>حذف</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
      {items.length >= 50 && <p className="muted small mt-sm">وصلت للحد الأقصى (50 سؤالًا).</p>}
      {/* keyed: each opening starts from the question as saved */}
      {editing && <FaqDialog key={editing === 'new' ? 'new' : editing.id} clinicId={clinicId} faq={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} title="حذف السؤال" confirmLabel="حذف" danger
        onConfirm={() => { if (deleting) act(remove, deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)}>
        سيُحذف السؤال وإجابته من الموقع نهائيًا. لإخفائه مؤقتًا أوقف «ظاهر» بدلًا من حذفه.
      </ConfirmDialog>
    </Card>
  );
}

const PROBLEM_TEXT = {
  question_short: 'اكتب السؤال (5 أحرف على الأقل).', question_long: 'السؤال أطول من 300 حرف.',
  answer_short: 'اكتب الإجابة.', answer_long: 'الإجابة أطول من 3000 حرف.',
} as const;

function FaqDialog({ clinicId, faq, onClose }: { clinicId: string; faq: Faq | null; onClose: () => void }) {
  const orig = faq ? toFaqForm(faq) : null;
  const [form, setForm] = useState<FaqForm>(orig ?? emptyFaq);
  const [tried, setTried] = useState(false);
  const services = useServices(clinicId);
  const save = useFaqMutation(clinicId, (body: Record<string, unknown>) => (faq ? faqApi.update(faq.id, body) : faqApi.create(body)));
  const problems = faqProblems(form);
  const body = faqBody(form, orig);
  const set = <K extends keyof FaqForm>(k: K) => (v: FaqForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = () => {
    setTried(true);
    if (problems.length || (orig && !Object.keys(body).length)) return;
    save.mutate(body, { onSuccess: onClose });
  };
  const err = (k: 'question' | 'answer') => (tried ? problems.find((p) => p.startsWith(k)) : undefined);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-start">{faq ? 'تعديل السؤال' : 'سؤال جديد'}</DialogTitle>
          <DialogDescription className="text-start">اكتب السؤال كما يسأله المريض، وإجابة قصيرة وواضحة.</DialogDescription>
        </DialogHeader>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) submit(); }}>
          <Field label="السؤال" hint={`${form.questionAr.trim().length} / 300`} error={err('question') && PROBLEM_TEXT[err('question')!]}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} value={form.questionAr} onChange={(e) => set('questionAr')(e.target.value)} maxLength={320} invalid={a.invalid} placeholder="مثال: هل تقبلون التأمين الطبي؟" />}
          </Field>
          <Field label="الإجابة" hint={`${form.answerAr.trim().length} / 3000`} error={err('answer') && PROBLEM_TEXT[err('answer')!]}>
            {(a) => <TextArea id={a.id} describedBy={a.describedBy} value={form.answerAr} onChange={(e) => set('answerAr')(e.target.value)} maxLength={3100} rows={5} invalid={a.invalid} />}
          </Field>
          <Field label="الخدمة المرتبطة" optional="اختياري" hint="ليظهر السؤال لاحقًا في صفحة الخدمة أيضًا.">
            {(a) => <Choice id={a.id} describedBy={a.describedBy} value={form.serviceId} onChange={set('serviceId')} noneLabel="بدون"
              options={(services.data ?? []).map((s) => ({ value: s.id, label: arName(s.name_ar, s.name_en, '—') }))} />}
          </Field>
          <Switch checked={form.isActive} label="يظهر على الموقع" onChange={set('isActive')} />
          <ErrorText error={save.error} />
          <div className="row-end">
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>إلغاء</Button>
            <Button type="submit" loading={save.isPending} disabled={!!orig && !Object.keys(body).length}>{faq ? 'حفظ' : 'إضافة السؤال'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SEO_PROBLEM = {
  title_short: `العنوان ${SEO_LIMITS.title.min} أحرف على الأقل، أو اتركه فارغًا.`, title_long: `العنوان ${SEO_LIMITS.title.max} حرفًا على الأكثر.`,
  description_short: `الوصف ${SEO_LIMITS.description.min} حرفًا على الأقل، أو اتركه فارغًا.`, description_long: `الوصف ${SEO_LIMITS.description.max} حرف على الأكثر.`,
} as const;

/** Phase 2C-3: the card around the form (the form starts from what is saved, and starts again from it after a save). */
function SeoCard({ clinicId }: { clinicId: string }) {
  const site = useWebsite(clinicId);
  if (site.isError) return <Card><h2>الظهور في جوجل وعند المشاركة</h2><ErrorText error={site.error} onRetry={() => void site.refetch()} /></Card>;
  if (!site.data) return <Card><h2>الظهور في جوجل وعند المشاركة</h2><Skeleton h={56} count={3} /></Card>;
  return <SeoForm clinicId={clinicId} status={site.data} />;
}

function SeoForm({ clinicId, status }: { clinicId: string; status: WebsiteStatus }) {
  const profile = useProfile(clinicId);
  const save = useSetSeo(clinicId);
  const orig = toSeoForm(status.seo);
  const [form, setForm] = useState<SeoForm>(orig);
  const [tried, setTried] = useState(false);
  const problems = seoProblems(form);
  const body = seoBody(form, orig);
  const set = <K extends keyof SeoForm>(k: K) => (v: SeoForm[K]) => { save.reset(); setForm((f) => ({ ...f, [k]: v })); };
  const name = arName(profile.data?.nameAr ?? null, profile.data?.nameEn ?? null, 'عيادتك');
  const preview = searchPreview(form, name, profile.data?.aboutAr ?? null);
  const err = (k: 'title' | 'description') => (tried ? problems.find((p) => p.startsWith(k)) : undefined);
  const count = (v: string, best: number, max: number) => {
    const n = v.trim().length;
    return `${n} / ${max}${n > best ? ` · ${'قد يُقص بعد'} ${best} ${'حرفًا في نتائج البحث'}` : ''}`;
  };
  return (
    <Card>
      <h2>الظهور في جوجل وعند المشاركة</h2>
      <p className="muted small">ما يراه الناس في نتائج البحث وعند إرسال رابط موقعك على واتساب أو فيسبوك. اترك أي خانة فارغة ليُستخدم الافتراضي.</p>
      <form className="stack mt-sm" onSubmit={(e) => {
        e.preventDefault(); setTried(true);
        if (!problems.length && Object.keys(body).length && !save.isPending) save.mutate(body, { onSuccess: (st) => { setForm(toSeoForm(st.seo)); setTried(false); } });
      }}>
        <Field label="عنوان الموقع في نتائج البحث" optional="اختياري" hint={count(form.title, SEO_LIMITS.title.best, SEO_LIMITS.title.max)} error={err('title') && SEO_PROBLEM[err('title')!]}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.title} onChange={(e) => set('title')(e.target.value)} maxLength={90}
            placeholder={`مثال: ${name} | تقويم وتبييض وزراعة أسنان`} />}
        </Field>
        <Field label="وصف الموقع" optional="اختياري" hint={count(form.description, SEO_LIMITS.description.best, SEO_LIMITS.description.max)} error={err('description') && SEO_PROBLEM[err('description')!]}>
          {(a) => <TextArea id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={form.description} onChange={(e) => set('description')(e.target.value)} maxLength={240} rows={3}
            placeholder="جملتان عن العيادة وخدماتها ومكانها، مثال: عيادة أسنان في مدينة نصر: تقويم، تبييض، زراعة. احجز موعدك أونلاين." />}
        </Field>
        <div className="seo-preview" aria-label="معاينة نتيجة البحث">
          <span className="seo-preview-url" dir="ltr">{status.hostname ?? 'clinic.example'}</span>
          <strong className="seo-preview-title">{preview.title}</strong>
          <span className="seo-preview-desc">{preview.description}</span>
        </div>
        <ImageField purpose="share" shape="wide" label="صورة المشاركة" value={form.shareImage} onChange={set('shareImage')}
          hint="تظهر عند مشاركة رابط موقعك. الأفضل صورة عرضية 1200×630 للعيادة من الداخل. بدونها تُصنع تلقائيًا من شعار العيادة ولونها." />
        <ErrorText error={save.error} />
        {save.isSuccess && <Alert tone="success">تم الحفظ. محركات البحث تحدّث نتائجها خلال أيام، وواتساب يحدّث المعاينة للروابط الجديدة.</Alert>}
        <div className="row-end">
          {Object.keys(body).length > 0 && <Button variant="ghost" onClick={() => { save.reset(); setForm(orig); setTried(false); }} disabled={save.isPending}>تراجع</Button>}
          <Button type="submit" loading={save.isPending} disabled={!Object.keys(body).length}>حفظ</Button>
        </div>
      </form>
    </Card>
  );
}
