import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { onColor, arName, readableOnWhite } from '@dental/ui/text';
import { api } from '../api';
import { ImageField } from '../components/image-field';
import { imageFieldValue } from '../media-model';
import { keys, useClinicPlan, useInvalidate, useOnboarding, useProfile, usePublish, useSetPoweredBy, useWebsite } from '../queries';
import type { ClinicPlanSummary, ClinicProfile, MediaImage } from '../types';
import { Choice } from '../components/choice';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, PageHeader, Skeleton, Switch, TextArea } from '../ui/components';
import { CheckIcon, GlobeIcon, PhoneIcon, ToothIcon } from '../ui/icons';
import { diffText, fmtNumber, LOC } from '../util';
import { billingCycleLabel, planFeatureLabel, planLimitLabel, subscriptionPaymentMethodLabel } from '../labels';
import { money } from '../money';
import { renewalNotice, trialDaysLeft, usageRows } from '../plan-model';

/** Dental-friendly presets; any #rrggbb works and the website keeps text readable on it. */
const PRESETS = ['#1d6fd8', '#0e9aa7', '#12b5a0', '#0f2f5c', '#6d4ed6', '#d6457a'];
const DEFAULT_BRAND = PRESETS[0];

type Form = {
  nameAr: string; nameEn: string; aboutAr: string; aboutEn: string;
  primaryPhone: string; whatsapp: string; email: string; brandColor: string; logo: MediaImage | null;
};
const toForm = (p: ClinicProfile): Form => ({
  nameAr: p.nameAr ?? '', nameEn: p.nameEn ?? '', aboutAr: p.aboutAr ?? '', aboutEn: p.aboutEn ?? '',
  primaryPhone: p.primaryPhone ?? '', whatsapp: p.whatsapp ?? '', email: p.email ?? '',
  brandColor: (p.brandColor ?? DEFAULT_BRAND).toLowerCase(), logo: p.logo ?? null,
});
const FIELDS = ['nameAr', 'nameEn', 'aboutAr', 'aboutEn', 'primaryPhone', 'whatsapp', 'email', 'brandColor'] as const;
type Changes = Partial<Record<(typeof FIELDS)[number] | 'logoFileId', string | null>>;

export function Profile({ clinicId, canEdit, canEditWebsite = false }: { clinicId: string; canEdit: boolean; canEditWebsite?: boolean }) {
  const profile = useProfile(clinicId);
  const onboarding = useOnboarding(clinicId).data;
  const publish = usePublish(clinicId);
  const qc = useQueryClient();
  const invalidate = useInvalidate(clinicId);
  // `orig` = what the form started from. Diffing against it (not the live query) means a background
  // refetch can never make someone else's change look like ours and get reverted on save.
  const [orig, setOrig] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    if (profile.data && !orig) { const f = toForm(profile.data); setOrig(f); setForm(f); }
  }, [profile.data, orig]);

  const logoChange = form && orig ? imageFieldValue(form.logo, orig.logo) : undefined;
  const changes: Changes = form && orig ? { ...diffText(orig, form, FIELDS), ...(logoChange !== undefined && { logoFileId: logoChange }) } : {};
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: (body: Changes) => api<ClinicProfile>('/clinic/profile', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (p, sent) => {
      qc.setQueryData(keys.profile(clinicId), p);
      const saved = toForm(p);
      setOrig(saved);
      // keep anything typed while the request was in flight; only the fields we sent take the server's value
      const field = (k: string): keyof Form => (k === 'logoFileId' ? 'logo' : (k as keyof Form));
      setForm((f) => (f ? { ...f, ...Object.fromEntries(Object.keys(sent).map((k) => [field(k), saved[field(k)]])) } : saved));
      void invalidate();
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (dirty && canEdit) save.mutate(changes); };
  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setForm((f) => (f ? { ...f, [k]: v } : f));
    if (save.isSuccess || save.isError) save.reset();
  };

  if (profile.isError) return <ErrorText error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!form) return <><PageHeader title="ملف العيادة" sub="هذه البيانات تظهر لمرضاك على موقع عيادتك" /><Skeleton h={120} count={3} /></>;

  return (
    <>
      <PageHeader title="ملف العيادة" sub="هذه البيانات تظهر لمرضاك على موقع عيادتك" />
      {canEdit && onboarding?.pendingChanges && !dirty && (
        <div className="publish-banner" role="status">
          <GlobeIcon />
          <div className="publish-text"><strong>لديك تغييرات لم تُنشر بعد على موقعك</strong><span className="muted small">الزوار يرون آخر نسخة منشورة فقط</span></div>
          <Button onClick={() => publish.mutate()} loading={publish.isPending}>نشر على الموقع</Button>
        </div>
      )}
      {publish.isSuccess && !onboarding?.pendingChanges && <Alert tone="success">تم النشر، موقعك محدّث</Alert>}
      <ErrorText error={publish.error} />
      <form onSubmit={submit} className="profile-grid">
        <fieldset disabled={!canEdit} className="contents">
        <div className="stack">
          <Card>
            <h2>اسم العيادة</h2>
            <div className="grid-2 mt">
              <Field label="اسم العيادة" hint="بالعربية، أو بالإنجليزية إن كان اسم علامتك التجارية مكتوبًا بها.">{(a) => <Input id={a.id} describedBy={a.describedBy} value={form.nameAr} onChange={set('nameAr')} dir="auto" maxLength={120} />}</Field>
            </div>
          </Card>

          <Card>
            <h2>نبذة عن العيادة</h2>
            <p className="muted small">جملتان أو ثلاث عن خبرتكم وما يميز عيادتكم</p>
            <div className="stack mt">
              <Field label="النبذة">{(a) => <TextArea id={a.id} value={form.aboutAr} onChange={set('aboutAr')} dir="rtl" maxLength={1000} />}</Field>
            </div>
          </Card>

          <Card>
            <h2>التواصل</h2>
            <div className="grid-2 mt">
              <Field label="رقم الحجز">{(a) => <Input id={a.id} type="tel" value={form.primaryPhone} onChange={set('primaryPhone')} dir="ltr" placeholder="01012345678" />}</Field>
              <Field label="واتساب" optional="اختياري">{(a) => <Input id={a.id} type="tel" value={form.whatsapp} onChange={set('whatsapp')} dir="ltr" placeholder="01012345678" />}</Field>
              <Field label="بريد العيادة" optional="اختياري">{(a) => <Input id={a.id} type="email" value={form.email} onChange={set('email')} dir="ltr" />}</Field>
            </div>
          </Card>
        </div>

        <aside className="stack profile-side">
          <Card>
            <ImageField purpose="logo" shape="logo" value={form.logo} label="شعار العيادة" disabled={!canEdit}
              onChange={(logo) => { setForm((f) => (f ? { ...f, logo } : f)); if (save.isSuccess || save.isError) save.reset(); }} />
          </Card>
          <Card>
            <h2>لون العلامة</h2>
            <p className="muted small">يُستخدم في أزرار موقعك وعناوينه</p>
            <div className="swatches mt" role="group" aria-label="لون العلامة">
              {PRESETS.map((c) => (
                <button key={c} type="button" aria-pressed={form.brandColor === c} aria-label={c} className="swatch"
                  style={{ background: c }} onClick={() => set('brandColor')({ target: { value: c } })}>
                  {form.brandColor === c && <CheckIcon size={16} color={onColor(c)} />}
                </button>
              ))}
              <label className="swatch swatch-custom" title="لون مخصص">
                <input type="color" value={form.brandColor} onChange={set('brandColor')} aria-label="لون مخصص" />
              </label>
            </div>
            <BrandPreview form={form} />
          </Card>

          <CurrencyCard clinicId={clinicId} current={profile.data?.currency ?? 'EGP'} canEdit={canEdit} />

          {canEdit && (
            <div className="save-bar">
              {save.isSuccess && !dirty && <Alert tone="success">تم الحفظ</Alert>}
              <ErrorText error={save.error} />
              <Button type="submit" block loading={save.isPending} disabled={!dirty}>{dirty ? 'حفظ' : 'تم الحفظ'}</Button>
              {dirty && <p className="muted small center">تغييرات غير محفوظة</p>}
            </div>
          )}
        </aside>
        </fieldset>
      </form>
      {/* Phase 1D: outside the profile form (its own permissions, saved on their own) */}
      {(canEdit || canEditWebsite) && (
        <div className="plan-row">
          {canEdit && <PlanCard clinicId={clinicId} />}
          {canEditWebsite && <BadgeCard clinicId={clinicId} />}
        </div>
      )}
    </>
  );
}

const FEATURES = ['remove_badge', 'custom_domain', 'online_payments'] as const;
/** Arabic counting: يوم واحد، يومين، 3–10 أيام، 11+ يومًا */
const daysText = (n: number) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : n <= 10 ? `${fmtNumber(n)} أيام` : `${fmtNumber(n)} يومًا`);
const fmtDate = (iso: string) => new Intl.DateTimeFormat(LOC, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
/** A calendar day (YYYY-MM-DD) as written, whatever the browser's zone. */
const fmtDay = (day: string) => new Intl.DateTimeFormat(LOC, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  trialing: { label: 'فترة تجريبية', tone: 'warning' }, active: { label: 'مفعّلة', tone: 'success' },
  past_due: { label: 'متأخرة في الدفع', tone: 'danger' }, suspended: { label: 'موقوفة', tone: 'danger' }, cancelled: { label: 'ملغاة', tone: 'neutral' },
};

/** Phase 1D (BIL-01): the clinic's plan, what it uses against each limit, and what the plan includes. */
function PlanCard({ clinicId }: { clinicId: string }) {
  const plan = useClinicPlan(clinicId);
  if (plan.isError) return <Card><h2>باقتك</h2><ErrorText error={plan.error} onRetry={() => void plan.refetch()} /></Card>;
  if (!plan.data) return <Card><h2>باقتك</h2><Skeleton h={40} count={3} /></Card>;
  const p = plan.data;
  const st = p.status ? STATUS[p.status] : undefined;
  const days = p.status === 'trialing' ? trialDaysLeft(p.trialEndsAt, Date.now()) : null;
  const notice = renewalNotice(p, Date.now());
  return (
    <Card className="plan-card">
      <div className="plan-head">
        <h2>باقتك: <bdi>{p.plan?.name ?? '—'}</bdi></h2>
        {st && <Badge tone={st.tone}>{st.label}</Badge>}
      </div>
      {days !== null && p.trialEndsAt && (
        <p className="muted small">{days > 0 ? `تنتهي الفترة التجريبية خلال ${daysText(days)} (${fmtDate(p.trialEndsAt)})` : 'انتهت الفترة التجريبية'}</p>
      )}
      {p.status === 'active' && p.currentPeriodEnd && <p className="muted small">الاشتراك {billingCycleLabel[p.billingCycle ?? 'monthly']} ساري حتى {fmtDate(p.currentPeriodEnd)}</p>}
      {notice?.kind === 'soon' && <Alert tone="info">ينتهي اشتراكك خلال {daysText(notice.days)} ({fmtDate(notice.endsAt)}). جدِّده قبلها حتى لا يتوقف العمل.</Alert>}
      {notice?.kind === 'past_due' && (
        <Alert tone="danger">
          انتهى اشتراكك ولم يُسجَّل التجديد بعد. تستمر العيادة في العمل حتى {fmtDate(notice.stopsAt)}
          {notice.days > 0 && <> (باقي {daysText(notice.days)})</>}، ثم يتوقف دخول الفريق والموقع والحجز حتى يُسجَّل الدفع. بياناتك محفوظة.
        </Alert>
      )}
      {!p.live && <Alert tone="danger">اشتراكك غير مفعّل: لا يمكن إضافة فروع أو أطباء أو مرضى أو أعضاء جدد حتى يُفعَّل.</Alert>}
      <ul className="plan-usage">
        {usageRows(p).map((r) => (
          <li key={r.key} className={`is-${r.level}`}>
            <div className="plan-usage-row">
              <span>{planLimitLabel[r.key === 'storageMb' ? 'storage_mb' : r.key]}</span>
              <span className="plan-usage-num">{r.limit === null ? <>{fmtNumber(r.used)} · بلا حد</> : <>{fmtNumber(r.used)} من {fmtNumber(r.limit)}</>}</span>
            </div>
            {r.limit !== null && <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent} aria-label={planLimitLabel[r.key === 'storageMb' ? 'storage_mb' : r.key]}><span style={{ width: `${r.percent}%` }} /></div>}
          </li>
        ))}
      </ul>
      <ul className="plan-features">
        {FEATURES.map((k) => (
          <li key={k} className={p.features[k] ? 'is-on' : undefined}>
            {p.features[k] ? <CheckIcon size={16} /> : <span aria-hidden>–</span>}
            <span>{planFeatureLabel[k]}</span>
            <span className="sr-only">{p.features[k] ? 'متاح' : 'غير متاح'}</span>
          </li>
        ))}
      </ul>
      <PaymentSection p={p} />
    </Card>
  );
}

/** Phase 2B: what renewing costs, how to pay (the platform's text), and the payments recorded so far. */
function PaymentSection({ p }: { p: ClinicPlanSummary }) {
  const price = p.price;
  return (
    <section className="plan-pay" aria-labelledby="plan-pay-title">
      <h3 id="plan-pay-title">الدفع والتجديد</h3>
      {price && (price.monthlyMinor > 0 || price.yearlyMinor > 0) && (
        <p className="small">
          قيمة الباقة: {price.monthlyMinor > 0 && <>{money(price.monthlyMinor, price.currency)} للشهر</>}
          {price.monthlyMinor > 0 && price.yearlyMinor > 0 && ' أو '}
          {price.yearlyMinor > 0 && <>{money(price.yearlyMinor, price.currency)} للسنة</>}
        </p>
      )}
      {p.paymentInstructions
        ? <div className="plan-pay-how"><strong className="small">طريقة الدفع</strong><p><bdi>{p.paymentInstructions}</bdi></p><p className="muted small">بعد الدفع أرسل رقم العملية لفريق المنصة ليتم تسجيله وتجديد اشتراكك.</p></div>
        : <p className="muted small">للدفع أو تغيير الباقة تواصل مع فريق المنصة، ويتم تجديد اشتراكك بعد تسجيل الدفعة.</p>}
      {p.payments.length > 0 && (
        <div className="table-wrap mt-sm">
          <table className="report-table">
            <caption className="sr-only">المدفوعات</caption>
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>المدة</th><th>الطريقة</th><th className="num">المبلغ</th></tr></thead>
            <tbody>
              {p.payments.map((x) => (
                <tr key={x.id}>
                  <td><bdi dir="ltr">{x.number}</bdi></td>
                  <td>{x.paidAt ? fmtDate(x.paidAt) : '—'}</td>
                  <td>{fmtDay(x.periodStart)} – {fmtDay(x.periodEnd)}</td>
                  <td>{x.method ? subscriptionPaymentMethodLabel[x.method] ?? x.method : '—'}</td>
                  <td className="num">{money(x.amountMinor, x.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Phase 1D (WEB-10): the platform badge at the foot of the clinic's site; hiding it needs a plan that includes it. */
function BadgeCard({ clinicId }: { clinicId: string }) {
  const site = useWebsite(clinicId);
  const set = useSetPoweredBy(clinicId);
  if (site.isError) return <Card><h2>شارة المنصة</h2><ErrorText error={site.error} onRetry={() => void site.refetch()} /></Card>;
  if (!site.data) return <Card><h2>شارة المنصة</h2><Skeleton h={40} count={1} /></Card>;
  const { showPoweredBy, canRemoveBadge } = site.data;
  const shown = showPoweredBy || !canRemoveBadge; // what visitors see
  return (
    <Card>
      <h2>شارة المنصة</h2>
      <p className="muted small">عبارة «بواسطة منصة الأسنان» في أسفل موقع عيادتك.</p>
      {canRemoveBadge ? (
        <div className="mt-sm">
          <Switch checked={showPoweredBy} onChange={(v) => { if (!set.isPending) set.mutate(v); }} label="إظهار الشارة على موقعي" />
          <p className="muted small mt-sm">يتغير على موقعك فورًا، بدون نشر.</p>
        </div>
      ) : (
        <Alert tone="info">إخفاء الشارة غير متاح في باقتك الحالية. رقِّ الباقة لإخفائها.</Alert>
      )}
      {set.isPending && <p className="muted small">جارٍ الحفظ…</p>}
      <ErrorText error={set.error} />
      {!canRemoveBadge && !showPoweredBy && <p className="muted small">الشارة ظاهرة على موقعك لأن باقتك لا تشمل إخفاءها.</p>}
      <span className="sr-only">{shown ? 'الشارة ظاهرة الآن على موقعك' : 'الشارة مخفية الآن من موقعك'}</span>
    </Card>
  );
}

/** Live preview of the website hero in the chosen colour, using the same contrast rules as the site. */
function BrandPreview({ form }: { form: Form }) {
  const brand = form.brandColor;
  const style = { '--brand': brand, '--on-brand': onColor(brand), '--brand-text': readableOnWhite(brand) } as CSSProperties;
  const name = arName(form.nameAr, form.nameEn, '—');
  const light = onColor(brand) !== '#ffffff';
  return (
    <div className="mt">
      <span className="eyebrow-label">معاينة</span>
      <div className="brand-preview" style={style} aria-hidden>
        <div className="bp-nav">{form.logo ? <img className="bp-logo" src={form.logo.thumbUrl} alt="" /> : <span className="bp-mark"><ToothIcon size={14} /></span>}<bdi>{name}</bdi></div>
        <div className="bp-body">
          <strong><bdi>{name}</bdi></strong>
          <p>{(form.aboutAr || form.aboutEn).slice(0, 90) || '…'}</p>
          <span className="bp-btn"><PhoneIcon size={14} />احجز الآن</span>
        </div>
      </div>
      {light && <p className="muted small mt-sm">لون فاتح: سيُكتب نص الأزرار بلون داكن ليبقى مقروءًا</p>}
    </div>
  );
}

const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'USD', 'EUR'];

/** CLR-09: the clinic's currency (default EGP); the API refuses a change once an invoice is issued. Saved on its own. */
function CurrencyCard({ clinicId, current, canEdit }: { clinicId: string; current: string; canEdit: boolean }) {
  const [value, setValue] = useState(current);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api<ClinicProfile>('/clinic/profile', { method: 'PATCH', body: JSON.stringify({ currency: value }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.profile(clinicId) }),
  });
  return (
    <Card>
      <h2>العملة</h2>
      <p className="muted small">عملة الفواتير والأسعار. تثبت بعد إصدار أول فاتورة.</p>
      <div className="row-end mt-sm">
        <Choice value={value} onChange={setValue} disabled={!canEdit} label="العملة" className="h-10 w-56 bg-card"
          options={(CURRENCIES.includes(current) ? CURRENCIES : [current, ...CURRENCIES]).map((c) => ({ value: c, label: c === 'EGP' ? `${'جنيه مصري'} (EGP)` : c }))} />
        {canEdit && <Button variant="secondary" loading={save.isPending} disabled={value === current} onClick={() => save.mutate()}>حفظ</Button>}
      </div>
      <ErrorText error={save.error} />
    </Card>
  );
}
