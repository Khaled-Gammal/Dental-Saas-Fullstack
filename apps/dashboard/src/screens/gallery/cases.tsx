import { useState } from 'react';
import { arName } from '@dental/ui/text';
import { Choice } from '../../components/choice';
import { ImageField } from '../../components/image-field';
import { navigate } from '../../hooks';
import { caseBody, caseProblems, emptyCase, moveId, toCaseForm, withNewImage, type CaseForm, type CaseProblem } from '../../gallery-model';
import { caseApi, useCaseMutation, useCases, useServices } from '../../queries';
import type { GalleryCase } from '../../types';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Skeleton, Switch } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { ChevronIcon, EditIcon, PlusIcon } from '../../ui/icons';
import { Thumb } from './shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** The gallery's two lists: its photos (`#/gallery`) and its before/after cases (`#/gallery?tab=cases`, Phase 2C-2). */
export function GalleryTabs({ current }: { current: 'photos' | 'cases' }) {
  return (
    <div className="seg mb" role="group" aria-label="المعرض">
      <button type="button" className={`seg-btn${current === 'photos' ? ' is-on' : ''}`} aria-pressed={current === 'photos'} onClick={() => navigate({ page: 'gallery' })}>الصور</button>
      <button type="button" className={`seg-btn${current === 'cases' ? ' is-on' : ''}`} aria-pressed={current === 'cases'} onClick={() => navigate({ page: 'gallery', query: { tab: 'cases' } })}>قبل وبعد</button>
    </div>
  );
}

const fmt = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }).format(new Date(iso));

/**
 * `#/gallery?tab=cases` (Phase 2C-2): before/after cases for the website. A case is published only with the patient's
 * written consent; the dashboard shows who confirmed it and when (recorded by the server). Withdrawing consent
 * unpublishes the case.
 */
export function GalleryCases({ clinicId }: { clinicId: string }) {
  const cases = useCases(clinicId);
  const [editing, setEditing] = useState<GalleryCase | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GalleryCase | null>(null);
  const [error, setError] = useState<unknown>(null);
  const update = useCaseMutation(clinicId, ({ id, body }: { id: string; body: Record<string, unknown> }) => caseApi.update(id, body));
  const reorder = useCaseMutation(clinicId, (ids: string[]) => caseApi.reorder(ids));
  const remove = useCaseMutation(clinicId, (id: string) => caseApi.remove(id));
  const busy = update.isPending || reorder.isPending || remove.isPending;
  const act = <V,>(m: { mutate: (v: V, o?: { onError?: (e: unknown) => void }) => void }, v: V) => { setError(null); m.mutate(v, { onError: setError }); };
  const items = cases.data ?? [];
  const add = <Button onClick={() => setEditing('new')} disabled={items.length >= 100}><PlusIcon size={18} />إضافة حالة</Button>;
  return (
    <>
      <PageHeader title="معرض الصور" sub="حالات قبل وبعد تظهر في قسم المعرض على موقعك، بموافقة المريض فقط" action={add} />
      <GalleryTabs current="cases" />
      <ErrorText error={error} />
      {cases.isError ? <ErrorText error={cases.error} onRetry={() => void cases.refetch()} />
        : cases.isLoading ? <div className="gallery-grid"><Skeleton h={220} count={4} /></div>
          : items.length === 0 ? <Card><EmptyState icon={<PlusIcon size={28} />} title="لا توجد حالات بعد" text="أضف صورة قبل العلاج وبعده لحالة وافق صاحبها كتابيًا على نشرها." action={add} /></Card>
            : (
              <ul className="case-grid" aria-busy={busy || undefined}>
                {items.map((c, i) => {
                  const what = c.captionAr ?? c.serviceName ?? 'حالة بدون وصف';
                  return (
                    <Card as="li" key={c.id} className={`case-card${c.isPublished ? '' : ' is-draft'}`}>
                      <div className="case-pair">
                        <figure><Thumb img={c.before} alt={`${what}: قبل`} sizes="160px" /><figcaption>قبل</figcaption></figure>
                        <figure><Thumb img={c.after} alt={`${what}: بعد`} sizes="160px" /><figcaption>بعد</figcaption></figure>
                      </div>
                      <div className="gallery-body">
                        <strong className="gallery-caption"><bdi>{what}</bdi></strong>
                        <span className="gallery-badges-inline">
                          <Badge tone={c.isPublished ? 'success' : 'neutral'}>{c.isPublished ? 'منشورة' : 'مسودة'}</Badge>
                          {c.consentConfirmed
                            ? <Badge tone="primary">بموافقة المريض</Badge>
                            : <Badge tone="warning">بدون موافقة</Badge>}
                        </span>
                        {c.consentConfirmed && c.consentConfirmedAt && (
                          <span className="muted small">أكّد الموافقة: <bdi>{c.consentConfirmedBy ?? '—'}</bdi> · {fmt(c.consentConfirmedAt)}</span>
                        )}
                        <div className="gallery-switches">
                          <Switch checked={c.isPublished} label="منشورة" ariaLabel={`نشر الحالة: ${what}`} disabled={busy || (!c.isPublished && !c.consentConfirmed)}
                            onChange={(v) => act(update, { id: c.id, body: { isPublished: v } })} />
                        </div>
                        {!c.consentConfirmed && <span className="muted small">لا تُنشر قبل تأكيد موافقة المريض (من «تعديل»).</span>}
                        <div className="gallery-actions">
                          <button type="button" className="icon-btn" disabled={i === 0 || busy} onClick={() => act(reorder, moveId(items.map((x) => x.id), c.id, -1))} aria-label={`تقديم الحالة: ${what}`}><ChevronIcon size={16} className="rot-up" /></button>
                          <button type="button" className="icon-btn" disabled={i === items.length - 1 || busy} onClick={() => act(reorder, moveId(items.map((x) => x.id), c.id, 1))} aria-label={`تأخير الحالة: ${what}`}><ChevronIcon size={16} className="rot-down" /></button>
                          <Button variant="ghost" onClick={() => setEditing(c)} aria-label={`تعديل الحالة: ${what}`}><EditIcon size={16} />تعديل</Button>
                          <Button variant="ghost" disabled={busy} onClick={() => setDeleting(c)} aria-label={`حذف الحالة: ${what}`}>حذف</Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </ul>
            )}
      {editing && <CaseDialog key={editing === 'new' ? 'new' : editing.id} clinicId={clinicId} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} title="حذف الحالة" confirmLabel="حذف" danger
        onConfirm={() => { if (deleting) act(remove, deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)}>
        ستُحذف الحالة وصورتاها من المعرض ومن الموقع نهائيًا.
      </ConfirmDialog>
    </>
  );
}

const PROBLEM: Record<CaseProblem, string> = {
  images_required: 'ارفع صورة قبل العلاج وصورة بعده.',
  same_image: 'صورة «قبل» وصورة «بعد» لازم تكونا مختلفتين.',
  consent_required: 'لا تُنشر الحالة قبل تأكيد موافقة المريض.',
  alt_required: 'اكتب وصفًا للحالة قبل نشرها.',
  too_long: 'الوصف أطول من المسموح.',
};

function CaseDialog({ clinicId, item, onClose }: { clinicId: string; item: GalleryCase | null; onClose: () => void }) {
  const orig = item ? toCaseForm(item) : null;
  const [form, setForm] = useState<CaseForm>(orig ?? emptyCase);
  const [tried, setTried] = useState(false);
  const services = useServices(clinicId);
  const save = useCaseMutation(clinicId, (body: Record<string, unknown>) => (item ? caseApi.update(item.id, body) : caseApi.create(body)));
  const problems = caseProblems(form);
  const body = caseBody(form, orig);
  const set = <K extends keyof CaseForm>(k: K) => (v: CaseForm[K]) => { save.reset(); setForm((f) => ({ ...f, [k]: v })); };
  const submit = () => {
    setTried(true);
    if (problems.length || (orig && !Object.keys(body).length)) return;
    save.mutate(body, { onSuccess: onClose });
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent dir="rtl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-start">{item ? 'تعديل الحالة' : 'حالة جديدة'}</DialogTitle>
          <DialogDescription className="text-start">صورتان بنفس الزاوية والإضاءة قدر الإمكان، بدون ما يظهر وجه المريض أو أي شيء يعرّف به.</DialogDescription>
        </DialogHeader>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) submit(); }}>
          <div className="grid-2">
            {/* a new image needs the consent confirmed again: the box is cleared */}
            <ImageField purpose="case" shape="wide" label="قبل العلاج" value={form.before} onChange={(img) => { save.reset(); setForm((f) => withNewImage(f, 'before', img)); }} />
            <ImageField purpose="case" shape="wide" label="بعد العلاج" value={form.after} onChange={(img) => { save.reset(); setForm((f) => withNewImage(f, 'after', img)); }} />
          </div>
          <div className="grid-2">
            <Field label="الوصف" hint="يظهر تحت الحالة، مثال: تبييض الأسنان في جلستين">
              {(a) => <Input id={a.id} describedBy={a.describedBy} value={form.captionAr} onChange={(e) => set('captionAr')(e.target.value)} maxLength={300} />}
            </Field>
            <Field label="الخدمة" optional="اختياري">
              {(a) => <Choice id={a.id} value={form.serviceId} onChange={set('serviceId')} noneLabel="بدون"
                options={(services.data ?? []).map((s) => ({ value: s.id, label: arName(s.name_ar, s.name_en, '—') }))} />}
            </Field>
          </div>
          <Field label="وصف الصورتين لقارئ الشاشة" optional="اختياري" hint="لو تركته فارغًا يُستخدم الوصف أعلاه.">
            {(a) => <Input id={a.id} describedBy={a.describedBy} value={form.altAr} onChange={(e) => set('altAr')(e.target.value)} maxLength={200} />}
          </Field>
          <label className="consent-check">
            <input type="checkbox" checked={form.consentConfirmed} onChange={(e) => { const v = e.target.checked; save.reset(); setForm((f) => ({ ...f, consentConfirmed: v, isPublished: v ? f.isPublished : false })); }} />
            <span>
              <strong>لدينا موافقة كتابية من المريض على نشر هاتين الصورتين على موقع العيادة.</strong>
              <span className="muted small block">يُسجَّل اسمك ووقت التأكيد. تغيير أي صورة يحتاج تأكيد الموافقة من جديد، وإلغاء الموافقة يسحب الحالة وصورها من الموقع فورًا.</span>
            </span>
          </label>
          <Switch checked={form.isPublished} label="تظهر على الموقع" disabled={!form.consentConfirmed} onChange={set('isPublished')} />
          {tried && problems.length > 0 && <ul className="field-error">{problems.map((p) => <li key={p}>{PROBLEM[p]}</li>)}</ul>}
          <ErrorText error={save.error} />
          <div className="row-end">
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>إلغاء</Button>
            <Button type="submit" loading={save.isPending} disabled={!!orig && !Object.keys(body).length}>{item ? 'حفظ' : 'إضافة الحالة'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
