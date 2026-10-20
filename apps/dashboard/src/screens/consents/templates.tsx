import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import type { ConsentText, ConsentTextDetail } from '../../consents-model';
import { navigate, useFlash, useLeave, useUnsavedChanges } from '../../hooks';
import { to } from '../../router';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, PageHeader, Skeleton, TextArea } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { RowMenu } from '../../ui/row-menu';
import { EditIcon, ShieldIcon } from '../../ui/icons';
import { FormPage, RouteLink } from '../../ui/page';
import { Checkbox } from '../../components/ui/checkbox';

export const consentKeys = {
  texts: (clinicId: string) => ['consents', clinicId, 'texts'] as const,
  text: (clinicId: string, key: string) => ['consents', clinicId, 'texts', key] as const,
  patient: (clinicId: string, patientId: string) => ['consents', clinicId, 'patient', patientId] as const,
};
export const useConsentTexts = (clinicId: string) =>
  useQuery({ queryKey: consentKeys.texts(clinicId), queryFn: () => api<ConsentText[]>('/consents/templates'), staleTime: 60_000 });

const day = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }).format(new Date(iso));

/** The consent texts table (U2): the text and where it stands, its version, who reviewed it and how often it was signed. */
const CONSENT_COLUMNS: Column<ConsentText>[] = [
  {
    id: 'title', header: 'النموذج', sortValue: (x) => x.title_ar,
    cell: (x) => <strong className={x.is_active ? undefined : 'muted'}><bdi>{x.title_ar}</bdi></strong>,
  },
  {
    id: 'state', header: 'الحالة',
    cell: (x) => (!x.is_active ? <Badge dot>مؤرشف</Badge> : x.is_draft ? <Badge tone="warning" dot>مسودة</Badge> : <Badge tone="success" dot>معتمد</Badge>),
  },
  { id: 'version', header: 'الإصدار', numeric: true, sortValue: (x) => x.version, cell: (x) => x.version },
  {
    id: 'reviewed', header: 'راجعه', hideOnMobile: true, sortValue: (x) => x.reviewed_at ?? '',
    cell: (x) => (x.reviewed_at ? <><bdi>{x.reviewed_by_name ?? '—'}</bdi><span className="muted small block">{day(x.reviewed_at)}</span></> : <span className="muted">—</span>),
  },
  { id: 'signed', header: 'مرات التوقيع', numeric: true, sortValue: (x) => x.signed ?? 0, cell: (x) => x.signed ?? 0 },
];

/**
 * `#/consents` (H9): the clinic's consent texts. Starter drafts are marked and cannot be signed until the owner reviews
 * and saves them; every save is a new version (consents already signed keep the version they signed).
 */
export function ConsentTexts({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const flash = useFlash();
  const list = useConsentTexts(clinicId);
  const texts = list.data ?? [];
  return (
    <>
      <PageHeader title="نماذج الموافقات" sub="نصوص الموافقات التي يوقّعها المرضى قبل العلاج. كل حفظ إصدار جديد، والموافقات الموقّعة تحتفظ بالنص الذي وُقّع."
        action={canWrite && <RouteLink route={to.create('consents')} className="btn btn-primary">نموذج جديد</RouteLink>} />
      {flash && <Alert tone="success">{flash}</Alert>}
      {texts.some((x) => x.is_draft && x.is_active) && <Alert tone="info">بدأت عيادتك بمسودات مقترحة. راجع كل مسودة وعدّلها بما يناسب عيادتك ثم احفظها، ولا يمكن توقيعها قبل ذلك.</Alert>}
      <DataTable
        label="نماذج الموافقات"
        rows={list.data}
        columns={CONSENT_COLUMNS}
        rowKey={(x) => x.key}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        actions={canWrite ? (x) => <RowMenu label={x.title_ar} actions={[{ label: x.is_draft ? 'راجع واعتمد' : 'تعديل', icon: <EditIcon size={16} />, route: to.edit('consents', x.key) }]} /> : undefined}
        onRowClick={canWrite ? (x) => navigate(to.edit('consents', x.key)) : undefined}
        empty={{ icon: <ShieldIcon size={28} />, title: 'لا توجد نماذج موافقات', text: 'أضف نموذجًا لكل علاج يحتاج إلى موافقة المريض.' }}
      />
    </>
  );
}

/** `#/consents/new`, `#/consents/<key>/edit`: write or revise a text; saving confirms it was reviewed. */
export function ConsentTextForm({ clinicId, textKey }: { clinicId: string; textKey?: string }) {
  const one = useQuery({
    queryKey: consentKeys.text(clinicId, textKey ?? ''), queryFn: () => api<ConsentTextDetail>(`/consents/templates/${textKey}`), enabled: !!textKey,
  });
  if (textKey && !one.data) return one.isError ? <Card><ErrorText error={one.error} onRetry={() => void one.refetch()} /></Card> : <Skeleton h={96} count={3} />;
  return <TextEditor clinicId={clinicId} detail={one.data} />;
}

function TextEditor({ clinicId, detail }: { clinicId: string; detail?: ConsentTextDetail }) {
  const current = detail?.current;
  const [title, setTitle] = useState(current?.title_ar ?? '');
  const [body, setBody] = useState(current?.body_ar ?? '');
  const [reviewed, setReviewed] = useState(false);
  const [tried, setTried] = useState(false);
  const qc = useQueryClient();
  const leave = useLeave(to.list('consents'));
  const dirty = title !== (current?.title_ar ?? '') || body !== (current?.body_ar ?? '');
  useUnsavedChanges(dirty, 'لديك تغييرات غير محفوظة. هل تريد المغادرة بدون حفظ؟');
  const refresh = () => qc.invalidateQueries({ queryKey: ['consents', clinicId] });
  const save = useMutation({
    mutationFn: () => api<ConsentTextDetail>(detail ? `/consents/templates/${detail.key}` : '/consents/templates', {
      method: detail ? 'PUT' : 'POST', body: JSON.stringify({ titleAr: title.trim(), bodyAr: body.trim() }),
    }),
    onSuccess: () => { void refresh(); leave('حُفظ النموذج.'); },
  });
  const archive = useMutation({
    mutationFn: (active: boolean) => api<ConsentTextDetail>(`/consents/templates/${detail!.key}/active`, { method: 'POST', body: JSON.stringify({ active }) }),
    onSuccess: () => { void refresh(); leave('حُفظ النموذج.'); },
  });
  const ok = title.trim().length >= 2 && body.trim().length >= 20 && reviewed;
  // a draft can be approved as it is; a reviewed text is saved only when it changed
  const canSave = ok && (dirty || !!current?.is_draft || !detail) && !save.isPending;
  const submit = (e: FormEvent) => { e.preventDefault(); setTried(true); if (canSave) save.mutate(); };
  const heading = detail ? current!.title_ar : 'نموذج جديد';
  const crumbs = [{ label: 'نظرة عامة', route: to.list('overview') }, { label: 'نماذج الموافقات', route: to.list('consents') }, { label: heading }];

  return (
    <FormPage title={heading} sub="اكتب النص كما سيقرؤه المريض. الحفظ يصنع إصدارًا جديدًا، وتبقى الإصدارات السابقة كما هي." crumbs={crumbs} back={to.list('consents')} onSubmit={submit} saving={save.isPending} canSave={canSave}
      error={save.error ?? archive.error}
      notice={current?.is_draft ? <Alert tone="info">هذه مسودة مقترحة من المنصة وليست استشارة قانونية. راجعها وعدّلها بما يناسب عيادتك، ثم احفظها ليصبح توقيعها ممكنًا.</Alert> : !current?.is_active && detail ? <Alert tone="info">هذا النموذج مؤرشف: لا يمكن توقيعه حتى تعيده.</Alert> : undefined}
      extra={detail && (
        <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(!current!.is_active)}>
          {current!.is_active ? 'أرشفة النموذج' : 'إعادة النموذج'}
        </Button>
      )}>
      <Card>
        <Field label="عنوان الموافقة" error={tried && title.trim().length < 2 ? 'اكتب العنوان.' : undefined}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />}
        </Field>
        <Field label="نص الموافقة" hint="سطر فارغ بين الفقرات. 20 حرفًا على الأقل." error={tried && body.trim().length < 20 ? 'اكتب نص الموافقة (20 حرفًا على الأقل).' : undefined}>
          {(a) => <TextArea id={a.id} describedBy={a.describedBy} value={body} onChange={(e) => setBody(e.target.value)} rows={14} maxLength={20_000} required />}
        </Field>
        <label className="check-row mt">
          <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
          <span>راجعت هذا النص وأعتمده ليوقّعه المرضى.</span>
        </label>
        {tried && !reviewed && <p className="field-error">أكّد أنك راجعت النص.</p>}
      </Card>
      {detail && detail.versions.length > 1 && (
        <Card>
          <h2>الإصدارات</h2>
          <ul className="line-list mt-sm">
            {detail.versions.map((v) => (
              <li key={v.id}>
                <span>
                  {'الإصدار {n}'.replace('{n}', String(v.version))} · {day(v.created_at)}
                  {v.is_draft ? <> · <Badge tone="warning">مسودة</Badge></> : v.reviewed_by_name && <span className="muted small"> · {v.reviewed_by_name}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small mt-sm">كل موافقة موقّعة تحتفظ بنص الإصدار الذي وُقّع.</p>
        </Card>
      )}
    </FormPage>
  );
}
