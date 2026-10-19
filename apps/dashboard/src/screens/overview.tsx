import { useEffect, useRef, useState } from 'react';
import { can, type Session } from '../api';
import { siteUrl } from '../config';
import { roleLabel, t, type Key } from '../i18n';
import { navigate } from '../hooks';
import { useOnboarding, usePublish } from '../queries';
import { to, type Page } from '../router';
import { Badge, Button, Card, ErrorText } from '../ui/components';
import { CheckIcon, CopyIcon, ExternalIcon } from '../ui/icons';
import { DentalArch } from '../ui/illustrations';
import { HomeFigures } from './home-figures';

const ARCH_TEETH = 14;
const COPIED_MS = 1800;

type Step = { key: Key; done: boolean; action?: { label: Key; go: () => void; busy?: boolean } };

/**
 * The home screen (SRS REPORT-006): a welcome, the member's own figures (HomeFigures), and — for the owner until it
 * is complete — the clinic setup checklist.
 */
export function Overview({ session }: { session: Session }) {
  const go = (p: Page) => navigate(to.list(p));
  const clinicId = session.clinic.id;
  const status = useOnboarding(clinicId).data; // derived on the server from the clinic's data
  const publish = usePublish(clinicId);
  const site = siteUrl(session.clinic.slug);

  const steps: Step[] = [
    { key: 'stepAccount', done: true },
    { key: 'stepProfile', done: !!status?.profile, action: { label: 'goProfile', go: () => go('profile') } },
    { key: 'stepBranch', done: !!status?.branches, action: { label: 'goBranches', go: () => go('branches') } },
    { key: 'stepHours', done: !!status?.hours, action: { label: 'goHours', go: () => go('branches') } },
    { key: 'stepDoctors', done: !!status?.doctors, action: { label: 'goDoctors', go: () => go('doctors') } },
    { key: 'stepServices', done: !!status?.services, action: { label: 'goServices', go: () => go('services') } },
    // "published" also means "nothing waiting": a pending draft re-opens the step
    { key: 'stepPublish', done: !!status?.published && !status?.pendingChanges, action: { label: 'goPublish', go: () => publish.mutate(), busy: publish.isPending } },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const setup = can(session, 'settings:write') && done < steps.length; // the checklist is the owner's, until it is done

  return (
    <>
      <section className="hero-card">
        <div className="hero-text">
          <p className="eyebrow">{t('welcome')}{'، '}<bdi>{session.user.name}</bdi> · {roleLabel(session.clinic.role)}</p>
          <h1>{t(setup ? 'overviewSub' : 'homeSub')}</h1>
          {can(session, 'website:write') && <SiteLink url={site} />}
        </div>
        {setup && (
          <div className="hero-art">
            <DentalArch filled={(done / steps.length) * ARCH_TEETH} label={`${done}/${steps.length} ${t('stepsDone')}`} />
            <span className="hero-art-caption">{t('archCaption')}</span>
          </div>
        )}
      </section>

      <HomeFigures clinicId={clinicId} />

      {setup && <ErrorText error={publish.error} />}
      {setup && <Card className="setup">
        <div className="setup-head">
          <div>
            <h2>{t('setupTitle')}</h2>
            <p className="muted">{t('setupSub')}</p>
          </div>
          <div className="progress-ring" style={{ ['--p' as string]: `${(done / steps.length) * 100}` }}
            role="img" aria-label={`${done}/${steps.length} ${t('stepsDone')}`}>
            <span><bdi>{done}/{steps.length}</bdi></span>
          </div>
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.key} className={`step${s.done ? ' done' : ''}${s === next ? ' current' : ''}`}>
              <span className="step-dot">{s.done ? <CheckIcon size={14} /> : i + 1}</span>
              <span className="step-label">{t(s.key)}</span>
              {!s.done && (s.action
                ? <Button variant={s === next ? 'primary' : 'secondary'} onClick={s.action.go} loading={s.action.busy}>{t(s.action.label)}</Button>
                : <Badge>{t('soon')}</Badge>)}
            </li>
          ))}
        </ol>
      </Card>}
    </>
  );
}

function SiteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current); // repeated clicks restart the timer instead of stacking them
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch { /* clipboard blocked: the link stays selectable */ }
  };
  return (
    <div className="site-link">
      <span className="site-url" dir="ltr">{url.replace(/^https?:\/\//, '')}</span>
      <button type="button" className="chip-btn" onClick={() => void copy()}>
        {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}{copied ? t('copied') : t('copy')}
      </button>
      <span role="status" className="sr-only">{copied ? t('copiedAnnounce') : ''}</span>
      <a className="chip-btn" href={url} target="_blank" rel="noreferrer"><ExternalIcon size={16} />{t('open')}</a>
    </div>
  );
}
