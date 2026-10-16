import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api, type Session } from '../api';
import { siteUrl } from '../config';
import { roleLabel, t, type Key, type Lang } from '../i18n';
import { openDays } from '../hours-model';
import { useBranches, useInvalidate, useOnboarding, usePublish } from '../queries';
import type { Branch } from '../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, LinkButton, PageHeader, Skeleton } from '../ui/components';
import { CalendarIcon, CheckIcon, CopyIcon, ExternalIcon, PinIcon, PlusIcon, ReceiptIcon, ShieldIcon } from '../ui/icons';
import { DentalArch } from '../ui/illustrations';
import type { Page } from '../util';
import { HoursEditor } from './hours-editor';

const ARCH_TEETH = 14;
const COPIED_MS = 1800;

type Step = { key: Key; done: boolean; action?: { label: Key; go: () => void; busy?: boolean } };

export function Overview({ lang, session, go }: { lang: Lang; session: Session; go: (p: Page) => void }) {
  const clinicId = session.clinic.id;
  const branches = useBranches(clinicId);
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

  return (
    <>
      <section className="hero-card">
        <div className="hero-text">
          <p className="eyebrow">{t('welcome', lang)}{lang === 'ar' ? '، ' : ', '}<bdi>{session.user.name}</bdi></p>
          <h1>{t('overviewSub', lang)}</h1>
          <SiteLink url={site} lang={lang} />
        </div>
        <div className="hero-art">
          <DentalArch filled={(done / steps.length) * ARCH_TEETH} label={`${done}/${steps.length} ${t('stepsDone', lang)}`} />
          <span className="hero-art-caption">{t('archCaption', lang)}</span>
        </div>
      </section>

      <div className="stats">
        <Stat label={t('statBranches', lang)} value={branches.isLoading ? '…' : branches.isError ? '—' : String(branches.data?.length ?? 0)} icon={<PinIcon />} />
        <Stat label={t('statPlan', lang)} value={session.clinic.status === 'trialing' ? t('trial', lang) : t('active', lang)} icon={<ReceiptIcon />} />
        <Stat label={t('statRole', lang)} value={roleLabel(session.clinic.role, lang)} icon={<ShieldIcon />} />
      </div>

      <ErrorText error={publish.error} />
      <Card className="setup">
        <div className="setup-head">
          <div>
            <h2>{t('setupTitle', lang)}</h2>
            <p className="muted">{t('setupSub', lang)}</p>
          </div>
          <div className="progress-ring" style={{ ['--p' as string]: `${(done / steps.length) * 100}` }}
            role="img" aria-label={`${done}/${steps.length} ${t('stepsDone', lang)}`}>
            <span><bdi>{done}/{steps.length}</bdi></span>
          </div>
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.key} className={`step${s.done ? ' done' : ''}${s === next ? ' current' : ''}`}>
              <span className="step-dot">{s.done ? <CheckIcon size={14} /> : i + 1}</span>
              <span className="step-label">{t(s.key, lang)}</span>
              {!s.done && (s.action
                ? <Button variant={s === next ? 'primary' : 'secondary'} onClick={s.action.go} loading={s.action.busy}>{t(s.action.label, lang)}</Button>
                : <Badge>{t('soon', lang)}</Badge>)}
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <span className="stat-text"><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

function SiteLink({ url, lang }: { url: string; lang: Lang }) {
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
        {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}{copied ? t('copied', lang) : t('copy', lang)}
      </button>
      <span role="status" className="sr-only">{copied ? t('copiedAnnounce', lang) : ''}</span>
      <a className="chip-btn" href={url} target="_blank" rel="noreferrer"><ExternalIcon size={16} />{t('open', lang)}</a>
    </div>
  );
}

const HOURS_EDITOR_ID = 'hours-editor';
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/;

/** `canWrite` only hides buttons the API would refuse (receptionists can view, not edit). */
export function Branches({ lang, clinicId, canWrite }: { lang: Lang; clinicId: string; canWrite: boolean }) {
  const branches = useBranches(clinicId);
  const invalidate = useInvalidate(clinicId);
  const [adding, setAdding] = useState(false);
  const [editingHours, setEditingHours] = useState<string | null>(null);
  const [nameAr, setNameAr] = useState('');
  const [slug, setSlug] = useState('');
  const create = useMutation({
    mutationFn: () => api<Branch>('/branches', { method: 'POST', body: JSON.stringify({ nameAr: nameAr.trim(), slug }) }),
    onSuccess: () => { setNameAr(''); setSlug(''); setAdding(false); void invalidate('branches'); },
  });
  const makeMain = useMutation({
    mutationFn: (id: string) => api<Branch[]>(`/branches/${id}/main`, { method: 'POST' }),
    onSuccess: () => void invalidate('branches'),
  });
  const editing = branches.data?.find((b) => b.id === editingHours);
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  const slugBad = slug.length > 0 && !SLUG_RE.test(slug);
  const count = branches.data?.length ?? 0;

  const openForm = () => { create.reset(); setAdding(true); };
  const addBtn = canWrite && !adding && <Button onClick={openForm}><PlusIcon size={18} />{t('addBranch', lang)}</Button>;

  return (
    <>
      <PageHeader title={t('branches', lang)} sub={t('branchesSub', lang)} action={count > 0 ? addBtn : undefined} />
      {create.isSuccess && !adding && <Alert tone="success">{t('branchAdded', lang)}</Alert>}

      {adding && (
        <Card className="form-card">
          <h2>{t('addBranch', lang)}</h2>
          <form onSubmit={submit} className="stack">
            <div className="grid-2">
              <Field label={t('nameAr', lang)}>{(a) => <Input id={a.id} value={nameAr} onChange={(e) => setNameAr(e.target.value)} required autoFocus maxLength={120} />}</Field>
              <Field label={t('branchSlug', lang)} hint={t('branchSlugHint', lang)} error={slugBad ? t('branchSlugHint', lang) : undefined}>
                {(a) => <Input id={a.id} describedBy={a.describedBy} invalid={a.invalid} value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))} dir="ltr" required maxLength={60} placeholder="nasr-city" spellCheck={false} />}
              </Field>
            </div>
            <ErrorText error={create.error} />
            <div className="row-end">
              <Button variant="ghost" type="button" onClick={() => setAdding(false)}>{t('cancel', lang)}</Button>
              <Button type="submit" loading={create.isPending} disabled={slugBad}>{t('save', lang)}</Button>
            </div>
          </form>
        </Card>
      )}

      {editing && <HoursEditor key={editing.id} id={HOURS_EDITOR_ID} lang={lang} clinicId={clinicId} branch={editing} onDone={() => setEditingHours(null)} />}
      <ErrorText error={makeMain.error} />

      {branches.isError ? (
        <ErrorText error={branches.error} onRetry={() => void branches.refetch()} />
      ) : branches.isLoading ? (
        <div className="cards"><Skeleton h={96} count={3} /></div>
      ) : count === 0 && !adding ? (
        <Card><EmptyState icon={<PinIcon size={28} />} title={t('noBranches', lang)} text={t('noBranchesText', lang)} action={addBtn} /></Card>
      ) : (
        <ul className="cards" aria-busy={branches.isFetching || undefined}>
          {branches.data?.map((b) => (
            <Card as="li" key={b.id} className="branch">
              <div className="branch-top">
                <span className="branch-icon"><PinIcon /></span>
                <div className="branch-text">
                  <strong><bdi>{pickName(lang, b.name_ar, b.name_en, b.slug)}</bdi></strong>
                  <code dir="ltr">{b.slug}</code>
                </div>
                {b.is_main && <Badge tone="primary">{t('main', lang)}</Badge>}
              </div>
              <div className="branch-hours">
                <CalendarIcon size={16} />
                {b.hours.length
                  ? <span>{t('openDays', lang)}: <strong><bdi>{openDays(b.hours)}/7</bdi></strong></span>
                  : <span className="warn-text">{t('noHours', lang)}</span>}
              </div>
              {canWrite && (
                <div className="branch-actions">
                  <Button variant={b.hours.length ? 'secondary' : 'primary'} onClick={() => setEditingHours(b.id)}
                    aria-expanded={editingHours === b.id} aria-controls={editingHours === b.id ? HOURS_EDITOR_ID : undefined}>
                    {t('workingHours', lang)}
                  </Button>
                  {!b.is_main && (
                    <LinkButton onClick={() => makeMain.mutate(b.id)} disabled={makeMain.isPending}>{t('makeMain', lang)}</LinkButton>
                  )}
                </div>
              )}
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}
