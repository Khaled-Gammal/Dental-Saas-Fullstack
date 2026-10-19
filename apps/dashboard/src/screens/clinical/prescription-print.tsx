import { useState } from 'react';
import { pickName } from '@dental/ui/text';
import { t, type Lang } from '../../i18n';
import { ageOn } from '../../patient-model';
import { useBranches, usePrescription, useProfile } from '../../queries';
import { to } from '../../router';
import { Alert, Button } from '../../ui/components';
import { Breadcrumbs, ResourceState, RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';

type Paper = 'A5' | 'A4';

/**
 * `#/prescriptions/<id>/print` (SRS VISIT-004): Arabic, right to left, with the clinic header and logo, the branch
 * address and phone, the doctor, the patient (name, age, file number) and the date. Drug names written in Latin
 * letters keep their own direction inside the Arabic text. Fits A5 or A4; the browser prints only the sheet.
 */
export function PrescriptionPrint({ lang, clinicId, id }: { lang: Lang; clinicId: string; id?: string }) {
  const rx = usePrescription(clinicId, id);
  const profile = useProfile(clinicId);
  const branches = useBranches(clinicId);
  const [paper, setPaper] = useState<Paper>('A5');
  if (!rx.data) {
    return <ResourceState isLoading={rx.isLoading} isError={rx.isError} error={rx.error} notFound={false} refetch={() => void rx.refetch()} back={to.list('patients')} backLabel={t('navPatients', lang)} />;
  }
  const r = rx.data;
  const clinic = profile.data;
  const branch = branches.data?.find((b) => b.id === r.branch_id);
  const issued = new Date(r.issued_at);
  const age = r.patient?.date_of_birth ? ageOn(r.patient.date_of_birth, issued.toLocaleDateString('en-CA')) : null;
  const date = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long', timeZone: 'Africa/Cairo' }).format(issued);
  return (
    <>
      <div className="no-print">
        <Breadcrumbs items={[{ label: t('visit', lang), route: to.visit(r.visit_id) }, { label: t('prescription', lang) }]} />
        {r.replaced_by_id && <Alert tone="info">{t('replacedNotice', lang)} <RouteLink route={to.printPrescription(r.replaced_by_id)}>{t('openCorrection', lang)}</RouteLink></Alert>}
        <div className="row-end mt-sm">
          <div className="seg" role="radiogroup" aria-label={t('paperSize', lang)}>
            {(['A5', 'A4'] as Paper[]).map((p) => <button key={p} type="button" role="radio" aria-checked={paper === p} className={`seg-btn${paper === p ? ' is-on' : ''}`} onClick={() => setPaper(p)}>{p}</button>)}
          </div>
          <Button onClick={() => window.print()}>{t('print', lang)}</Button>
        </div>
      </div>
      {/* the page size follows the choice; margins stay small so A5 keeps room for the lines */}
      <style>{`@page { size: ${paper}; margin: 10mm; }`}</style>
      <article className={`rx-sheet rx-${paper.toLowerCase()}`} dir="rtl" lang="ar">
        <header className="rx-head">
          <div>
            <h1 className="rx-clinic">{clinic ? pickName('ar', clinic.nameAr, clinic.nameEn) : ''}</h1>
            {branch && <p className="rx-branch">{pickName('ar', branch.name_ar, branch.name_en)}{branch.address_ar && ` — ${branch.address_ar}`}{branch.phone && <> · <bdi dir="ltr">{branch.phone}</bdi></>}</p>}
          </div>
          {clinic?.logo && <img className="rx-logo" src={clinic.logo.thumbUrl} alt="" />}
        </header>
        <div className="rx-doctor">
          <strong>{pickName('ar', r.doctor.name_ar, r.doctor.name_en)}</strong>
          {(r.doctor.title_ar || r.doctor.title_en) && <span>{pickName('ar', r.doctor.title_ar, r.doctor.title_en)}</span>}
        </div>
        <dl className="rx-patient">
          <div><dt>{t('patient', 'ar')}</dt><dd><bdi>{r.patient?.full_name}</bdi></dd></div>
          {age !== null && <div><dt>{t('age', 'ar')}</dt><dd>{fmtNumber(age, 'ar')} {t('years', 'ar')}</dd></div>}
          {r.patient && <div><dt>{t('fileNo', 'ar')}</dt><dd>{fmtNumber(r.patient.file_no, 'ar')}</dd></div>}
          <div><dt>{t('date', 'ar')}</dt><dd>{date}</dd></div>
        </dl>
        <div className="rx-symbol" aria-hidden>℞</div>
        <ol className="rx-items">
          {r.items.map((i) => (
            <li key={i.id}>
              <bdi dir="auto" className="rx-drug">{i.drug_name}</bdi>
              {(i.dose || i.frequency || i.duration) && <div className="rx-how">{[i.dose, i.frequency, i.duration].filter(Boolean).map((x, k) => <span key={k}><bdi>{x}</bdi></span>)}</div>}
              {i.instructions && <div className="rx-note"><bdi>{i.instructions}</bdi></div>}
            </li>
          ))}
        </ol>
        {r.notes && <p className="rx-note">{r.notes}</p>}
        <footer className="rx-foot"><span>{t('doctorSignature', 'ar')}</span></footer>
      </article>
    </>
  );
}
