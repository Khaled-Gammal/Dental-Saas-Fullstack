import { useState } from 'react';
import { navigate, useDebounced, useFlash } from '../../hooks';
import { t, type Lang } from '../../i18n';
import { ageOn } from '../../patient-model';
import { usePatients } from '../../queries';
import { to } from '../../router';
import type { PatientRow } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Input, PageHeader, Skeleton } from '../../ui/components';
import { CalendarIcon, PlusIcon, UsersIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';

const today = () => new Date().toLocaleDateString('en-CA');

/**
 * `#/patients`: one search box for name, mobile or file number (the API decides which), newest first otherwise,
 * with "load more" on a keyset cursor. `canWrite` = patients:write, `canBook` = appointments:write.
 */
export function PatientsList({ lang, clinicId, canWrite, canBook }: { lang: Lang; clinicId: string; canWrite: boolean; canBook: boolean }) {
  const flash = useFlash();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 250);
  const list = usePatients(clinicId, search);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const add = canWrite && <Button onClick={() => navigate(to.create('patients'))}><PlusIcon size={18} />{t('addPatient', lang)}</Button>;

  return (
    <>
      <PageHeader title={t('navPatients', lang)} sub={t('patientsSub', lang)} action={add || undefined} />
      {flash && <Alert tone="success">{flash}</Alert>}
      <div className="patient-search">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('patientSearchHint', lang)} aria-label={t('patientSearch', lang)} autoFocus />
      </div>

      {list.isError ? (
        <ErrorText error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Skeleton h={64} count={5} />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<UsersIcon size={28} />} title={t(search ? 'noPatientMatch' : 'noPatients', lang)} text={t(search ? 'noPatientMatchText' : 'noPatientsText', lang)} action={add || undefined} /></Card>
      ) : (
        <>
          <ul className="patient-rows" aria-busy={list.isFetching || undefined}>
            {rows.map((p) => <PatientRowItem key={p.id} p={p} lang={lang} canBook={canBook} />)}
          </ul>
          {list.hasNextPage && (
            <div className="row-center mt"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('loadMore', lang)}</Button></div>
          )}
        </>
      )}
    </>
  );
}

function PatientRowItem({ p, lang, canBook }: { p: PatientRow; lang: Lang; canBook: boolean }) {
  const age = ageOn(p.date_of_birth ?? '', today());
  return (
    <Card as="li" className="patient-row">
      <RouteLink route={to.view('patients', p.id)} className="patient-main">
        <span className="patient-avatar" aria-hidden>{p.full_name.trim().slice(0, 1)}</span>
        <span className="patient-text">
          <strong><bdi>{p.full_name}</bdi></strong>
          <span className="muted small">
            <span>{t('fileNo', lang)} <bdi dir="ltr">{fmtNumber(p.file_no, lang)}</bdi></span>
            <span dir="ltr">{p.phone}</span>
            {age !== null && <span>{fmtNumber(age, lang)} {t('years', lang)}</span>}
            {p.gender && <span>{t(p.gender === 'male' ? 'male' : 'female', lang)}</span>}
          </span>
        </span>
      </RouteLink>
      <span className="patient-badges">
        {p.tags.includes('needs_review') && <Badge tone="warning">{t('needsReview', lang)}</Badge>}
        {p.is_blocked && <Badge>{t('blocked', lang)}</Badge>}
        {p.tags.filter((x) => x !== 'needs_review').slice(0, 2).map((x) => <Badge key={x}><bdi>{x}</bdi></Badge>)}
      </span>
      {canBook && !p.is_blocked && (
        <RouteLink route={to.create('appointments', { patient: p.id })} className="btn btn-secondary btn-sm"><CalendarIcon size={16} />{t('book', lang)}</RouteLink>
      )}
    </Card>
  );
}
