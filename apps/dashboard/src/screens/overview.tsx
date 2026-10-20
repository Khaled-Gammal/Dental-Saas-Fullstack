import { useEffect, useRef, useState } from 'react';
import { can, type Session } from '../api';
import { siteUrl } from '../config';
import { roleLabel } from '../labels';
import { navigate } from '../hooks';
import { useHome, useOnboarding, usePublish } from '../queries';
import { to, type Page } from '../router';
import { Badge, Button, Card, ErrorText, PageHeader } from '../ui/components';
import { CheckIcon, CopyIcon, ExternalIcon } from '../ui/icons';
import { HomeFigures } from './home-figures';
import { StatsControls, type StatsFilters } from './overview-stats';

const COPIED_MS = 1800;

type Step = { key: string; done: boolean; action?: { label: string; go: () => void; busy?: boolean } };

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
    { key: 'إنشاء الحساب وتأكيد الموبايل', done: true },
    { key: 'إكمال ملف العيادة (رقم الحجز والنبذة)', done: !!status?.profile, action: { label: 'إكمال الملف', go: () => go('profile') } },
    { key: 'إضافة فرع واحد على الأقل', done: !!status?.branches, action: { label: 'إدارة الفروع', go: () => go('branches') } },
    { key: 'تحديد مواعيد العمل', done: !!status?.hours, action: { label: 'تحديد المواعيد', go: () => go('branches') } },
    { key: 'إضافة الأطباء', done: !!status?.doctors, action: { label: 'إضافة الأطباء', go: () => go('doctors') } },
    { key: 'إضافة الخدمات والأسعار', done: !!status?.services, action: { label: 'إضافة الخدمات', go: () => go('services') } },
    // "published" also means "nothing waiting": a pending draft re-opens the step
    { key: 'نشر الموقع', done: !!status?.published && !status?.pendingChanges, action: { label: 'نشر الموقع', go: () => publish.mutate(), busy: publish.isPending } },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const setup = can(session, 'settings:write') && done < steps.length; // the checklist is the owner's, until it is done
  // owner and accountant: the figures follow a period and branch chosen in the header (this month by default, 2026-10-21)
  const stats = can(session, 'reports:read');
  const home = useHome(clinicId); // the same request the figures make (one cache): the clinic's today
  const [filters, setFilters] = useState<StatsFilters>({ preset: 'thisMonth', branchId: '', today: '' });
  const today = home.data?.today ?? '';
  const statsFilters = today ? { ...filters, today } : null;

  return (
    <>
      {/* a compact header (overview redesign 2026-10-21): what changes the page (period, branch) is its action; the
          website link is a quiet line under the greeting */}
      <PageHeader title={<>أهلًا{'، '}<bdi>{session.user.name}</bdi></>}
        sub={<>
          {roleLabel(session.clinic.role, session.clinic.roleName)} — {setup ? 'هذا ملخص عيادتك وخطوات تجهيزها' : 'ملخص يومك في العيادة'}
          {can(session, 'website:write') && <SiteLink url={site} />}
        </>}
        action={stats && statsFilters ? <StatsControls clinicId={clinicId} value={statsFilters} onChange={setFilters} /> : undefined} />

      {setup && <ErrorText error={publish.error} />}
      {setup && <Card className="setup">
        <div className="setup-head">
          <div>
            <h2>جهّز عيادتك</h2>
            <p className="muted">أكمل الخطوات لنشر موقعك واستقبال الحجوزات</p>
          </div>
          <div className="progress-ring" style={{ ['--p' as string]: `${(done / steps.length) * 100}` }}
            role="img" aria-label={`${done}/${steps.length} ${'خطوات مكتملة'}`}>
            <span><bdi>{done}/{steps.length}</bdi></span>
          </div>
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.key} className={`step${s.done ? ' done' : ''}${s === next ? ' current' : ''}`}>
              <span className="step-dot">{s.done ? <CheckIcon size={14} /> : i + 1}</span>
              <span className="step-label">{s.key}</span>
              {!s.done && (s.action
                ? <Button variant={s === next ? 'primary' : 'secondary'} onClick={s.action.go} loading={s.action.busy}>{s.action.label}</Button>
                : <Badge>قريبًا</Badge>)}
            </li>
          ))}
        </ol>
      </Card>}

      <HomeFigures session={session} filters={stats ? statsFilters : null} />
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
    <span className="ov-site">
      <span className="muted">موقعك:</span>
      <a href={url} target="_blank" rel="noreferrer" dir="ltr" className="ov-site-url">{url.replace(/^https?:\/\//, '')}<ExternalIcon size={14} aria-hidden /></a>
      <button type="button" className="ov-site-copy" onClick={() => void copy()} aria-label="نسخ">
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}{copied ? 'تم النسخ' : 'نسخ'}
      </button>
      <span role="status" className="sr-only">{copied ? 'تم نسخ رابط الموقع' : ''}</span>
    </span>
  );
}
