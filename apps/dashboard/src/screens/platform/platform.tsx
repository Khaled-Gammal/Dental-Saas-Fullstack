import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { t, type Key } from '../../i18n';
import { money } from '../../money';
import { filterClinics, papi, platformHref, trialDaysLeft, type PlatformRoute } from '../../platform-model';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, OtpInput, PasswordInput, Skeleton, Switch, TextArea } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { ShieldIcon } from '../../ui/icons';
import { AuthLayout } from '../auth';

interface Me { id: string; name: string; email: string }
interface Clinic {
  id: string; slug: string; name_ar: string | null; name_en: string | null; status: string; created_at: string; suspended_at: string | null;
  suspension_reason: string | null; suspension_kind: 'manual' | 'trial_ended' | null;
  plan_code: string | null; plan_name_ar: string | null; subscription_status: string | null; trial_ends_at: string | null;
  billing_cycle: string | null; current_period_end: string | null;
  members: number; branches: number; patients: number; appointments_30d: number; last_login_at: string | null; owner_email: string | null;
}
interface AuditRow { id: string; action: string; tenant_id: string | null; details: Record<string, unknown>; created_at: string; actor: string | null }
interface ClinicDetail extends Clinic { notes: { id: string; body: string; created_at: string; author: string }[]; history: AuditRow[] }
interface Plan {
  id: string; code: string; name_ar: string; price_monthly_minor: number; price_yearly_minor: number; currency: string; trial_days: number;
  limits: Record<string, number | null>; features: Record<string, boolean>; is_public: boolean; clinics: number;
}

const KEY = ['platform'] as const;
const STATUS_TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning'> = {
  onboarding: 'neutral', trialing: 'primary', active: 'success', past_due: 'warning', suspended: 'warning', cancelled: 'neutral',
};
const LIMIT_KEYS = ['branches', 'staff', 'doctors', 'patients', 'storage_mb'] as const;
const FEATURE_KEYS = ['custom_domain', 'online_payments', 'remove_badge'] as const;
const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }).format(new Date(iso)) : '—');
const when = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const clinicName = (c: { name_ar: string | null; name_en: string | null; slug: string }) => c.name_ar || c.name_en || c.slug;

/**
 * `#/platform` (H5; SRS ADM-01, ADM-02, ADM-04): the platform admin panel. It has its own sign-in (password, then a
 * code emailed to the admin) and its own session cookie, separate from any clinic session.
 */
export function PlatformApp({ route }: { route: PlatformRoute }) {
  const me = useQuery({ queryKey: [...KEY, 'me'], queryFn: () => papi<Me>('/platform/me'), retry: false });
  if (me.isLoading) return <div className="boot" role="status" aria-label={t('loading')}><Skeleton h={48} count={2} /></div>;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <PlatformLogin />;
    return <div className="platform-main"><ErrorText error={me.error} onRetry={() => void me.refetch()} /></div>;
  }
  return (
    <PlatformShell me={me.data!} route={route}>
      {route.page === 'clinics' && <ClinicsPage />}
      {route.page === 'clinic' && <ClinicPage id={route.id} />}
      {route.page === 'plans' && <PlansPage />}
      {route.page === 'activity' && <ActivityPage />}
    </PlatformShell>
  );
}

function PlatformLogin() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: () => papi<{ maskedEmail: string }>('/platform/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) }),
    onSuccess: (r) => setSentTo(r.maskedEmail),
  });
  const verify = useMutation({
    mutationFn: () => papi<Me>('/platform/auth/verify', { method: 'POST', body: JSON.stringify({ email: email.trim(), code }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (sentTo) { if (code.length === 6) verify.mutate(); } else login.mutate(); };
  return (
    <AuthLayout>
      <header className="form-head">
        <h2>{t('pl_signInTitle')}</h2>
        <p>{sentTo ? t('pl_codeSent').replace('{email}', sentTo) : t('pl_signInSub')}</p>
      </header>
        <form onSubmit={submit} className="stack">
          {!sentTo ? (
            <>
              <Field label={t('email')}>
                {(a) => <Input id={a.id} describedBy={a.describedBy} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />}
              </Field>
              <Field label={t('password')}>
                {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required showLabel={t('showPw')} hideLabel={t('hidePw')} />}
              </Field>
              <ErrorText error={login.error} />
              <Button type="submit" block loading={login.isPending}>{t('signIn')}</Button>
            </>
          ) : (
            <>
              <Field label={t('code')}>{(a) => <OtpInput id={a.id} value={code} onChange={setCode} invalid={!!verify.error} label={t('code')} />}</Field>
              <ErrorText error={verify.error} />
              <Button type="submit" block loading={verify.isPending} disabled={code.length !== 6}>{t('pl_confirm')}</Button>
            </>
          )}
        </form>
    </AuthLayout>
  );
}

function PlatformShell({ me, route, children }: { me: Me; route: PlatformRoute; children: ReactNode }) {
  const qc = useQueryClient();
  const out = useMutation({ mutationFn: () => papi('/platform/auth/logout', { method: 'POST' }), onSettled: () => qc.removeQueries({ queryKey: KEY }) });
  const tab = (r: PlatformRoute, label: Key) => (
    <a href={platformHref(r)} className={`seg-btn${route.page === r.page || (r.page === 'clinics' && route.page === 'clinic') ? ' is-on' : ''}`}>{t(label)}</a>
  );
  return (
    <div className="platform">
      <header className="platform-bar">
        <strong><ShieldIcon size={18} /> {t('pl_title')}</strong>
        <nav className="seg" aria-label={t('pl_title')}>
          {tab({ page: 'clinics' }, 'pl_clinics')}{tab({ page: 'plans' }, 'pl_plans')}{tab({ page: 'activity' }, 'pl_activity')}
        </nav>
        <span className="row-end">
          <span className="muted small"><bdi>{me.name}</bdi></span>
          <Button variant="ghost" loading={out.isPending} onClick={() => out.mutate()}>{t('signOut')}</Button>
        </span>
      </header>
      <main className="platform-main">{children}</main>
    </div>
  );
}

// ---------- ADM-01 the clinics ----------
function ClinicsPage() {
  const clinics = useQuery({ queryKey: [...KEY, 'clinics'], queryFn: () => papi<Clinic[]>('/platform/clinics') });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const rows = filterClinics(clinics.data ?? [], q, status);
  const count = (s: string) => clinics.data?.filter((c) => c.status === s).length ?? 0;
  return (
    <>
      <div className="page-head"><div><h1>{t('pl_clinics')}</h1><p>{t('pl_clinicsSub')}</p></div></div>
      {clinics.data && (
        <div className="stats">
          {(['trialing', 'active', 'past_due', 'suspended'] as const).map((s) => (
            <div key={s} className="stat"><span className="stat-text"><small>{t(`pl_status_${s}` as Key)}</small><strong>{count(s)}</strong></span></div>
          ))}
        </div>
      )}
      <Card>
        <div className="report-filters">
          <Field label={t('pl_search')}>{(a) => <Input id={a.id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pl_searchHint')} />}</Field>
          <Field label={t('status')}>
            {(a) => <Choice id={a.id} value={status} onChange={setStatus}
              options={['all', 'onboarding', 'trialing', 'active', 'past_due', 'suspended', 'cancelled'].map((s) => ({ value: s, label: t(s === 'all' ? 'pl_allStatuses' : (`pl_status_${s}` as Key)) }))} />}
          </Field>
        </div>
        {clinics.isError ? <ErrorText error={clinics.error} onRetry={() => void clinics.refetch()} />
          : !clinics.data ? <Skeleton h={56} count={4} />
          : !rows.length ? <EmptyState icon={<ShieldIcon size={28} />} title={t('pl_noClinics')} text={t('pl_noClinicsText')} />
          : (
            <div className="table-wrap mt">
              <table className="report-table">
                <thead><tr>
                  <th scope="col">{t('pl_clinic')}</th><th scope="col">{t('status')}</th><th scope="col">{t('pl_plan')}</th><th scope="col">{t('pl_trial')}</th>
                  <th scope="col" className="num">{t('pl_members')}</th><th scope="col" className="num">{t('pl_patients')}</th>
                  <th scope="col" className="num">{t('pl_appointments30')}</th><th scope="col">{t('pl_lastLogin')}</th>
                </tr></thead>
                <tbody>
                  {rows.map((c) => {
                    const left = trialDaysLeft(c.trial_ends_at, c.subscription_status);
                    return (
                      <tr key={c.id}>
                        <td><a href={platformHref({ page: 'clinic', id: c.id })}><bdi>{clinicName(c)}</bdi></a><span className="muted small block" dir="ltr">{c.slug}</span></td>
                        <td><Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{t(c.suspension_kind === 'trial_ended' ? 'pl_trialEnded' : (`pl_status_${c.status}` as Key))}</Badge></td>
                        <td>{c.plan_name_ar ?? '—'}</td>
                        <td>{left === null ? '—' : left >= 0 ? t('pl_daysLeft').replace('{n}', String(left)) : t('pl_trialEnded')}</td>
                        <td className="num">{c.members}</td><td className="num">{c.patients}</td><td className="num">{c.appointments_30d}</td>
                        <td>{date(c.last_login_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </>
  );
}

// ---------- ADM-02 one clinic ----------
function ClinicPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const c = useQuery({ queryKey: [...KEY, 'clinic', id], queryFn: () => papi<ClinicDetail>(`/platform/clinics/${id}`) });
  const plans = useQuery({ queryKey: [...KEY, 'plans'], queryFn: () => papi<Plan[]>('/platform/plans') });
  const act = useMutation({
    mutationFn: (v: { path: string; body?: object }) => papi<ClinicDetail>(`/platform/clinics/${id}/${v.path}`, { method: 'POST', body: JSON.stringify(v.body ?? {}) }),
    onSuccess: (d) => { qc.setQueryData([...KEY, 'clinic', id], d); void qc.invalidateQueries({ queryKey: [...KEY, 'clinics'] }); },
  });
  const [until, setUntil] = useState('');
  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState('monthly');
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const addNote = useMutation({
    mutationFn: () => papi(`/platform/clinics/${id}/notes`, { method: 'POST', body: JSON.stringify({ body: note.trim() }) }),
    onSuccess: () => { setNote(''); void qc.invalidateQueries({ queryKey: [...KEY, 'clinic', id] }); },
  });
  if (c.isError) return <Card><ErrorText error={c.error} onRetry={() => void c.refetch()} /></Card>;
  if (!c.data) return <Skeleton h={96} count={3} />;
  const d = c.data;
  const left = trialDaysLeft(d.trial_ends_at, d.subscription_status);
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <>
      <p><a href={platformHref({ page: 'clinics' })}>{t('pl_clinics')}</a></p>
      <div className="page-head">
        <div>
          <h1><bdi>{clinicName(d)}</bdi> <Badge tone={STATUS_TONE[d.status] ?? 'neutral'}>{t(`pl_status_${d.status}` as Key)}</Badge></h1>
          <p dir="ltr" className="muted">{d.slug} · {d.owner_email ?? '—'}</p>
        </div>
      </div>
      <div className="stats">
        {([['pl_members', d.members], ['pl_branches', d.branches], ['pl_patients', d.patients], ['pl_appointments30', d.appointments_30d]] as const).map(([k, v]) => (
          <div key={k} className="stat"><span className="stat-text"><small>{t(k)}</small><strong>{v}</strong></span></div>
        ))}
      </div>
      <Card>
        <h2>{t('pl_subscription')}</h2>
        <dl className="detail-list mt-sm">
          <div><dt>{t('pl_plan')}</dt><dd>{d.plan_name_ar ?? '—'}</dd></div>
          <div><dt>{t('pl_subStatus')}</dt><dd>{d.subscription_status ? t(`pl_status_${d.subscription_status}` as Key) : '—'}</dd></div>
          {d.subscription_status === 'active' && <div><dt>{t('pl_periodEnd')}</dt><dd>{date(d.current_period_end)} ({t(`pl_cycle_${d.billing_cycle ?? 'monthly'}` as Key)})</dd></div>}
          <div><dt>{t('pl_trial')}</dt><dd>{d.trial_ends_at ? `${date(d.trial_ends_at)}${left !== null ? ` (${left >= 0 ? t('pl_daysLeft').replace('{n}', String(left)) : t('pl_trialEnded')})` : ''}` : '—'}</dd></div>
          <div><dt>{t('pl_signedUp')}</dt><dd>{date(d.created_at)}</dd></div>
          <div><dt>{t('pl_lastLogin')}</dt><dd>{date(d.last_login_at)}</dd></div>
        </dl>
        <div className="grid-2 mt">
          {d.subscription_status === 'trialing' && (
            <Field label={t('pl_extendTrial')}>
              {(a) => (
                <div className="row-start">
                  <DatePicker id={a.id} value={until} onChange={setUntil} min={today} placeholder={t('pickDate')} />
                  <Button variant="secondary" disabled={!until} loading={act.isPending && act.variables?.path === 'trial'}
                    onClick={() => act.mutate({ path: 'trial', body: { until } })}>{t('save')}</Button>
                </div>
              )}
            </Field>
          )}
          {(d.subscription_status === 'trialing' || d.subscription_status === 'past_due' || d.subscription_status === 'suspended') && (
            <Field label={t('pl_activate')} hint={t('pl_activateHint')}>
              {(a) => (
                <div className="row-start">
                  <Choice id={a.id} value={cycle} onChange={setCycle} options={(['monthly', 'yearly'] as const).map((c) => ({ value: c, label: t(`pl_cycle_${c}` as Key) }))} />
                  <Button loading={act.isPending && act.variables?.path === 'activate'} onClick={() => act.mutate({ path: 'activate', body: { cycle } })}>{t('pl_activateBtn')}</Button>
                </div>
              )}
            </Field>
          )}
          <Field label={t('pl_changePlan')}>
            {(a) => (
              <div className="row-start">
                <Choice id={a.id} value={planId} onChange={setPlanId} placeholder={t('pl_pickPlan')}
                  options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name_ar }))} />
                <Button variant="secondary" disabled={!planId} loading={act.isPending && act.variables?.path === 'plan'}
                  onClick={() => act.mutate({ path: 'plan', body: { planId } })}>{t('save')}</Button>
              </div>
            )}
          </Field>
        </div>
        <div className="row-end mt">
          {d.status === 'suspended'
            ? d.suspension_kind !== 'trial_ended' && <Button loading={act.isPending && act.variables?.path === 'reactivate'} onClick={() => act.mutate({ path: 'reactivate' })}>{t('pl_reactivate')}</Button>
            : d.status !== 'cancelled' && <Button variant="secondary" onClick={() => { setReason(''); setSuspending(true); }}>{t('pl_suspend')}</Button>}
        </div>
        {d.status === 'suspended' && (
          <Alert tone="info">
            {t(d.suspension_kind === 'trial_ended' ? 'pl_trialEndedNote' : 'pl_suspendedNote')}
            {d.suspension_kind === 'manual' && d.suspension_reason && <> {t('pl_suspendReason')}: <bdi>{d.suspension_reason}</bdi></>}
          </Alert>
        )}
        <ErrorText error={act.error} />
      </Card>
      <Card>
        <h2>{t('pl_notes')}</h2>
        <form className="stack mt-sm" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
          <Field label={t('pl_newNote')}>{(a) => <TextArea id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />}</Field>
          <ErrorText error={addNote.error} />
          <div className="row-end"><Button type="submit" variant="secondary" loading={addNote.isPending} disabled={!note.trim()}>{t('add')}</Button></div>
        </form>
        <ul className="line-list mt">
          {d.notes.map((n) => <li key={n.id}><span><bdi>{n.body}</bdi><span className="muted small block">{n.author} · {when(n.created_at)}</span></span></li>)}
        </ul>
      </Card>
      <Card>
        <h2>{t('pl_history')}</h2>
        <AuditList rows={d.history} />
      </Card>
      <ConfirmDialog open={suspending} title={t('pl_suspend')} confirmLabel={t('pl_suspend')} danger
        onConfirm={() => { if (reason.trim().length >= 3) { setSuspending(false); act.mutate({ path: 'suspend', body: { reason: reason.trim() } }); } }}
        onCancel={() => setSuspending(false)}>
        <p>{t('pl_suspendText')}</p>
        <Field label={t('reason')} hint={t('reasonHint')}>{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
      </ConfirmDialog>
    </>
  );
}

function AuditList({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="muted small mt-sm">{t('pl_noHistory')}</p>;
  return (
    <ul className="line-list mt-sm">
      {rows.map((r) => (
        <li key={r.id}>
          <span>
            <strong>{t(`pl_action_${r.action.replace('.', '_')}` as Key)}</strong>
            {typeof r.details?.reason === 'string' && <> — <bdi>{r.details.reason}</bdi></>}
            <span className="muted small block">{r.actor ?? t('pl_system')} · {when(r.created_at)}</span>
          </span>
          {r.tenant_id && <span className="line-end"><a href={platformHref({ page: 'clinic', id: r.tenant_id })}>{t('pl_openClinic')}</a></span>}
        </li>
      ))}
    </ul>
  );
}

function ActivityPage() {
  const audit = useQuery({ queryKey: [...KEY, 'audit'], queryFn: () => papi<AuditRow[]>('/platform/audit') });
  return (
    <>
      <div className="page-head"><div><h1>{t('pl_activity')}</h1><p>{t('pl_activitySub')}</p></div></div>
      <Card>{audit.isError ? <ErrorText error={audit.error} /> : !audit.data ? <Skeleton h={48} count={4} /> : <AuditList rows={audit.data} />}</Card>
    </>
  );
}

// ---------- ADM-04 plans ----------
function PlansPage() {
  const plans = useQuery({ queryKey: [...KEY, 'plans'], queryFn: () => papi<Plan[]>('/platform/plans') });
  return (
    <>
      <div className="page-head"><div><h1>{t('pl_plans')}</h1><p>{t('pl_plansSub')}</p></div></div>
      {plans.isError ? <ErrorText error={plans.error} /> : !plans.data ? <Skeleton h={96} count={2} /> : plans.data.map((p) => <PlanCard key={p.id} p={p} />)}
    </>
  );
}

const pounds = (minor: number) => String(minor / 100);
const toMinor = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v) * 100));

function PlanCard({ p }: { p: Plan }) {
  const qc = useQueryClient();
  const [name, setName] = useState(p.name_ar);
  const [monthly, setMonthly] = useState(pounds(p.price_monthly_minor));
  const [yearly, setYearly] = useState(pounds(p.price_yearly_minor));
  const [trial, setTrial] = useState(String(p.trial_days));
  const [limits, setLimits] = useState<Record<string, string>>(() => Object.fromEntries(LIMIT_KEYS.map((k) => [k, p.limits[k] == null ? '' : String(p.limits[k])])));
  const [features, setFeatures] = useState<Record<string, boolean>>(() => Object.fromEntries(FEATURE_KEYS.map((k) => [k, !!p.features[k]])));
  const [isPublic, setPublic] = useState(p.is_public);
  const [saved, setSaved] = useState(false);
  const m = toMinor(monthly), y = toMinor(yearly), days = Number(trial);
  const ok = name.trim().length >= 2 && m !== null && y !== null && Number.isInteger(days) && days >= 0 && days <= 90;
  const save = useMutation({
    mutationFn: () => papi<Plan>(`/platform/plans/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nameAr: name.trim(), priceMonthlyMinor: m, priceYearlyMinor: y, trialDays: days, isPublic, features,
        limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, limits[k].trim() === '' ? null : Math.max(0, Math.floor(Number(limits[k])))])),
      }),
    }),
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: [...KEY, 'plans'] }); },
  });
  return (
    <Card as="form" className="stack">
      <div className="row-between"><h2>{p.name_ar} <span className="muted small" dir="ltr">({p.code})</span></h2><span className="muted small">{t('pl_planClinics').replace('{n}', String(p.clinics))}</span></div>
      <div className="grid-2">
        <Field label={t('pl_planName')}>{(a) => <Input id={a.id} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={60} />}</Field>
        <Field label={t('pl_trialDays')}>{(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={trial} onChange={(e) => { setTrial(e.target.value); setSaved(false); }} />}</Field>
        <Field label={`${t('pl_priceMonthly')} (${money(0, p.currency).replace(/^0\s*/, '')})`}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={monthly} onChange={(e) => { setMonthly(e.target.value); setSaved(false); }} invalid={m === null} />}</Field>
        <Field label={`${t('pl_priceYearly')} (${money(0, p.currency).replace(/^0\s*/, '')})`}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={yearly} onChange={(e) => { setYearly(e.target.value); setSaved(false); }} invalid={y === null} />}</Field>
      </div>
      <h3>{t('pl_limits')}</h3>
      <p className="muted small">{t('pl_limitsHint')}</p>
      <div className="grid-2">
        {LIMIT_KEYS.map((k) => (
          <Field key={k} label={t(`pl_limit_${k}` as Key)}>
            {(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={limits[k]} placeholder={t('pl_unlimited')} onChange={(e) => { setLimits((l) => ({ ...l, [k]: e.target.value })); setSaved(false); }} />}
          </Field>
        ))}
      </div>
      <h3>{t('pl_features')}</h3>
      {FEATURE_KEYS.map((k) => <Switch key={k} checked={features[k]} label={t(`pl_feature_${k}` as Key)} onChange={(v) => { setFeatures((f) => ({ ...f, [k]: v })); setSaved(false); }} />)}
      <Switch checked={isPublic} label={t('pl_planPublic')} onChange={(v) => { setPublic(v); setSaved(false); }} />
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      <ErrorText error={save.error} />
      <div className="row-end"><Button onClick={() => save.mutate()} disabled={!ok} loading={save.isPending}>{t('save')}</Button></div>
    </Card>
  );
}

