import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import type { ConsentText, ConsentTextDetail } from '../../consents-model';
import { navigate, useFlash, useLeave, useUnsavedChanges } from '../../hooks';
import { t } from '../../i18n';
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
    id: 'title', header: t('consentColTitle'), sortValue: (x) => x.title_ar,
    cell: (x) => <strong className={x.is_active ? undefined : 'muted'}><bdi>{x.title_ar}</bdi></strong>,
  },
  {
    id: 'state', header: t('status'),
    cell: (x) => (!x.is_active ? <Badge dot>{t('consentArchived')}</Badge> : x.is_draft ? <Badge tone="warning" dot>{t('consentDraft')}</Badge> : <Badge tone="success" dot>{t('consentReviewed')}</Badge>),
  },
  { id: 'version', header: t('consentColVersion'), numeric: true, sortValue: (x) => x.version, cell: (x) => x.version },
  {
    id: 'reviewed', header: t('consentColReviewed'), hideOnMobile: true, sortValue: (x) => x.reviewed_at ?? '',
    cell: (x) => (x.reviewed_at ? <><bdi>{x.reviewed_by_name ?? '—'}</bdi><span className="muted small block">{day(x.reviewed_at)}</span></> : <span className="muted">—</span>),
  },
  { id: 'signed', header: t('consentColSigned'), numeric: true, sortValue: (x) => x.signed ?? 0, cell: (x) => x.signed ?? 0 },
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
      <PageHeader title={t('navConsents')} sub={t('consentsSub')}
        action={canWrite && <RouteLink route={to.create('consents')} className="btn btn-primary">{t('newConsentText')}</RouteLink>} />
      {flash && <Alert tone="success">{flash}</Alert>}
      {texts.some((x) => x.is_draft && x.is_active) && <Alert tone="info">{t('consentDraftsNote')}</Alert>}
      <DataTable
        label={t('navConsents')}
        rows={list.data}
        columns={CONSENT_COLUMNS}
        rowKey={(x) => x.key}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        actions={canWrite ? (x) => <RowMenu label={x.title_ar} actions={[{ label: x.is_draft ? t('consentReview') : t('edit'), icon: <EditIcon size={16} />, route: to.edit('consents', x.key) }]} /> : undefined}
        onRowClick={canWrite ? (x) => navigate(to.edit('consents', x.key)) : undefined}
        empty={{ icon: <ShieldIcon size={28} />, title: t('noConsentTexts'), text: t('noConsentTextsText') }}
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
  useUnsavedChanges(dirty, t('leaveUnsaved'));
  const refresh = () => qc.invalidateQueries({ queryKey: ['consents', clinicId] });
  const save = useMutation({
    mutationFn: () => api<ConsentTextDetail>(detail ? `/consents/templates/${detail.key}` : '/consents/templates', {
      method: detail ? 'PUT' : 'POST', body: JSON.stringify({ titleAr: title.trim(), bodyAr: body.trim() }),
    }),
    onSuccess: () => { void refresh(); leave(t('consentSaved')); },
  });
  const archive = useMutation({
    mutationFn: (active: boolean) => api<ConsentTextDetail>(`/consents/templates/${detail!.key}/active`, { method: 'POST', body: JSON.stringify({ active }) }),
    onSuccess: () => { void refresh(); leave(t('consentSaved')); },
  });
  const ok = title.trim().length >= 2 && body.trim().length >= 20 && reviewed;
  // a draft can be approved as it is; a reviewed text is saved only when it changed
  const canSave = ok && (dirty || !!current?.is_draft || !detail) && !save.isPending;
  const submit = (e: FormEvent) => { e.preventDefault(); setTried(true); if (canSave) save.mutate(); };
  const heading = detail ? current!.title_ar : t('newConsentText');
  const crumbs = [{ label: t('navOverview'), route: to.list('overview') }, { label: t('navConsents'), route: to.list('consents') }, { label: heading }];

  return (
    <FormPage title={heading} sub={t('consentFormSub')} crumbs={crumbs} back={to.list('consents')} onSubmit={submit} saving={save.isPending} canSave={canSave}
      error={save.error ?? archive.error}
      notice={current?.is_draft ? <Alert tone="info">{t('consentDraftBanner')}</Alert> : !current?.is_active && detail ? <Alert tone="info">{t('consentArchivedBanner')}</Alert> : undefined}
      extra={detail && (
        <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(!current!.is_active)}>
          {current!.is_active ? t('consentArchive') : t('consentRestore')}
        </Button>
      )}>
      <Card>
        <Field label={t('consentTitle')} error={tried && title.trim().length < 2 ? t('consentTitleNeeded') : undefined}>
          {(a) => <Input id={a.id} describedBy={a.describedBy} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />}
        </Field>
        <Field label={t('consentBody')} hint={t('consentBodyHint')} error={tried && body.trim().length < 20 ? t('consentBodyNeeded') : undefined}>
          {(a) => <TextArea id={a.id} describedBy={a.describedBy} value={body} onChange={(e) => setBody(e.target.value)} rows={14} maxLength={20_000} required />}
        </Field>
        <label className="check-row mt">
          <Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
          <span>{t('consentReviewedCheck')}</span>
        </label>
        {tried && !reviewed && <p className="field-error">{t('consentReviewedNeeded')}</p>}
      </Card>
      {detail && detail.versions.length > 1 && (
        <Card>
          <h2>{t('consentVersions')}</h2>
          <ul className="line-list mt-sm">
            {detail.versions.map((v) => (
              <li key={v.id}>
                <span>
                  {t('consentVersion').replace('{n}', String(v.version))} · {day(v.created_at)}
                  {v.is_draft ? <> · <Badge tone="warning">{t('consentDraft')}</Badge></> : v.reviewed_by_name && <span className="muted small"> · {v.reviewed_by_name}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small mt-sm">{t('consentVersionsNote')}</p>
        </Card>
      )}
    </FormPage>
  );
}
