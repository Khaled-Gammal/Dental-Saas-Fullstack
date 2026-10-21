import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { billingCycleLabel, clinicStatusLabel, leadStatusLabel, legalDocLabel, planFeatureLabel, planLimitLabel, platformActionLabel } from '../../labels';
import { money } from '../../money';
import { filterClinics, filterLeads, LEAD_STATUSES, papi, platformHref, trialDaysLeft, type LeadStatus, type PlatformRoute } from '../../platform-model';
import { Alert, Badge, Button, Card, ErrorText, Field, initials, Input, OtpInput, PageHeader, PasswordInput, Skeleton, Switch, TextArea } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { DataTable, type Column } from '../../ui/data-table';
import { ShieldIcon } from '../../ui/icons';
import { RowMenu } from '../../ui/row-menu';
import { AuthLayout } from '../auth';
import { Building2, ChevronsUpDown, FileText, History, Inbox, Layers, LogOut, Mail, Phone, ShieldCheck, type LucideIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';

interface Me { id: string; name: string; email: string }
interface Clinic {
  id: string; slug: string; name_ar: string | null; name_en: string | null; status: string; created_at: string; suspended_at: string | null;
  suspension_reason: string | null; suspension_kind: 'manual' | 'trial_ended' | null;
  plan_code: string | null; plan_name_ar: string | null; subscription_status: string | null; trial_ends_at: string | null;
  billing_cycle: string | null; current_period_end: string | null;
  members: number; branches: number; patients: number; appointments_30d: number; last_login_at: string | null; owner_email: string | null;
  /** H8: the owner deleted the clinic; its data is erased at delete_after unless it is restored */
  deletion: { requested_at: string; delete_after: string } | null;
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
  if (me.isLoading) return <div className="boot" role="status" aria-label="جارٍ التحميل…"><Skeleton h={48} count={2} /></div>;
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
      {route.page === 'legal' && <LegalAdminPage />}
      {route.page === 'leads' && <LeadsPage />}
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
        <h2>دخول لوحة إدارة المنصة</h2>
        <p>{sentTo ? 'أرسلنا رمزًا من 6 أرقام إلى {email}. اكتبه لإكمال الدخول.'.replace('{email}', sentTo) : 'لمديري المنصة فقط. بعد كلمة المرور نرسل رمزًا إلى بريدك.'}</p>
      </header>
        <form onSubmit={submit} className="stack">
          {!sentTo ? (
            <>
              <Field label="البريد الإلكتروني">
                {(a) => <Input id={a.id} describedBy={a.describedBy} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />}
              </Field>
              <Field label="كلمة المرور">
                {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required showLabel="إظهار كلمة المرور" hideLabel="إخفاء كلمة المرور" />}
              </Field>
              <ErrorText error={login.error} />
              <Button type="submit" block loading={login.isPending}>تسجيل الدخول</Button>
            </>
          ) : (
            <>
              <Field label="الرمز">{(a) => <OtpInput id={a.id} value={code} onChange={setCode} invalid={!!verify.error} label="الرمز" />}</Field>
              <ErrorText error={verify.error} />
              <Button type="submit" block loading={verify.isPending} disabled={code.length !== 6}>تأكيد الدخول</Button>
            </>
          )}
        </form>
    </AuthLayout>
  );
}

type PlatformPage = Exclude<PlatformRoute['page'], 'clinic'>;
const PLATFORM_NAV: { page: PlatformPage; label: string; icon: LucideIcon }[] = [
  { page: 'clinics', label: 'العيادات', icon: Building2 },
  { page: 'leads', label: 'طلبات التواصل', icon: Inbox },
  { page: 'plans', label: 'الخطط', icon: Layers },
  { page: 'legal', label: 'المستندات القانونية', icon: FileText },
  { page: 'activity', label: 'السجل', icon: History },
];
const NAV_ACTIVE = 'data-[active=true]:bg-primary-50 data-[active=true]:text-primary-700 data-[active=true]:font-semibold data-[active=true]:[&>svg]:text-primary-500';

/**
 * The panel's shell, like the clinic dashboard's (redesign R1): shadcn/ui's Sidebar on the right, collapsible to icons on
 * desktop and a sheet on phones; the header with the toggle and the page's name. New contact requests are counted beside
 * their page.
 */
function PlatformShell({ me, route, children }: { me: Me; route: PlatformRoute; children: ReactNode }) {
  const current: PlatformPage = route.page === 'clinic' ? 'clinics' : route.page;
  const newLeads = useQuery({ queryKey: [...KEY, 'leads'], queryFn: () => papi<Lead[]>('/platform/leads') }).data?.filter((l) => l.status === 'new').length ?? 0;
  return (
    <SidebarProvider>
      <Sidebar side="right" collapsible="icon" aria-label="لوحة إدارة المنصة">
        <SidebarHeader className="p-3">
          <div className="flex items-center gap-2.5 px-1 pt-1">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-accent text-white"><ShieldCheck className="size-[18px]" /></span>
            <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <strong className="truncate text-sm text-ink">لوحة إدارة المنصة</strong>
              <small className="truncate text-xs text-muted-foreground">منصة الأسنان</small>
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent><PlatformNav current={current} newLeads={newLeads} /></SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter><AdminMenu me={me} /></SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 bg-surface">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger className="-ms-1 size-9" aria-label="القائمة" />
          <Separator orientation="vertical" className="h-5" />
          <span className="truncate font-semibold text-ink">{PLATFORM_NAV.find((n) => n.page === current)?.label}</span>
        </header>
        <main className="platform-main">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function PlatformNav({ current, newLeads }: { current: PlatformPage; newLeads: number }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {PLATFORM_NAV.map(({ page, label, icon: Icon }) => (
        <SidebarMenuItem key={page}>
          <SidebarMenuButton asChild isActive={current === page} tooltip={label} className={`h-9 text-sm text-sidebar-foreground ${NAV_ACTIVE}`}>
            <a href={platformHref({ page } as PlatformRoute)} aria-current={current === page ? 'page' : undefined} onClick={() => setOpenMobile(false)}>
              <Icon /><span>{label}</span>
            </a>
          </SidebarMenuButton>
          {page === 'leads' && newLeads > 0 && (
            <SidebarMenuBadge className="right-auto left-1 rounded-full bg-primary-50 px-2 text-[0.6875rem] text-primary-700" aria-label={`${newLeads} ${'جديد'}`}>{newLeads}</SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

/** The admin at the foot of the sidebar; signing out from its menu. */
function AdminMenu({ me }: { me: Me }) {
  const qc = useQueryClient();
  const out = useMutation({ mutationFn: () => papi('/platform/auth/logout', { method: 'POST' }), onSettled: () => qc.removeQueries({ queryKey: KEY }) });
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={me.name} className="data-[state=open]:bg-sidebar-accent">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">{initials(me.name)}</span>
              <span className="flex min-w-0 flex-1 flex-col text-start leading-tight">
                <strong className="truncate text-sm text-ink"><bdi>{me.name}</bdi></strong>
                <small className="truncate text-xs text-muted-foreground" dir="ltr">{me.email}</small>
              </span>
              <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
            <DropdownMenuItem disabled={out.isPending} onSelect={() => out.mutate()} className="text-destructive focus:text-destructive">
              <LogOut className="text-destructive" />خروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning';
/**
 * Figures that filter the table under them (Untitled UI's metric cards): a press shows that status only, pressing it
 * again (or «الكل») shows everything.
 */
function StatusCards({ label, items, value, onChange }: {
  label: string; items: { value: string; label: string; count: number; tone: Tone }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="pl-status" role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.value} type="button" aria-pressed={value === it.value} className={`pl-status-card tone-${it.tone}${value === it.value ? ' is-on' : ''}`}
          onClick={() => onChange(value === it.value ? 'all' : it.value)}>
          <span className="pl-status-label"><span className="pl-dot" aria-hidden />{it.label}</span>
          <strong>{it.count}</strong>
        </button>
      ))}
    </div>
  );
}

// ---------- ADM-01 the clinics ----------
function ClinicsPage() {
  const clinics = useQuery({ queryKey: [...KEY, 'clinics'], queryFn: () => papi<Clinic[]>('/platform/clinics') });
  const [status, setStatus] = useState('all');
  // the status filter is the panel's own (filterClinics); the table searches, sorts and pages what is left (redesign R4)
  const rows = clinics.data ? filterClinics(clinics.data, '', status) : undefined;
  const count = (s: string) => clinics.data?.filter((c) => c.status === s).length ?? 0;
  const columns: Column<Clinic>[] = [
    {
      id: 'clinic', header: 'العيادة', sortValue: (c) => clinicName(c),
      cell: (c) => <><a href={platformHref({ page: 'clinic', id: c.id })} className="font-semibold no-underline hover:underline"><bdi>{clinicName(c)}</bdi></a><span className="muted small block" dir="ltr">{c.slug}</span></>,
    },
    {
      id: 'status', header: 'الحالة', sortValue: (c) => c.status,
      cell: (c) => (
        <>
          <Badge tone={STATUS_TONE[c.status] ?? 'neutral'} dot>{c.deletion ? 'بانتظار الحذف' : c.suspension_kind === 'trial_ended' ? 'انتهت التجربة' : (clinicStatusLabel[c.status])}</Badge>
          {c.deletion && <span className="muted small block">{date(c.deletion.delete_after)}</span>}
        </>
      ),
    },
    { id: 'plan', header: 'الخطة', hideOnMobile: true, sortValue: (c) => c.plan_name_ar, cell: (c) => c.plan_name_ar ?? '—' },
    {
      id: 'trial', header: 'نهاية التجربة', hideOnMobile: true, sortValue: (c) => trialDaysLeft(c.trial_ends_at, c.subscription_status),
      cell: (c) => { const left = trialDaysLeft(c.trial_ends_at, c.subscription_status); return left === null ? '—' : left >= 0 ? 'باقي {n} يوم'.replace('{n}', String(left)) : 'انتهت التجربة'; },
    },
    { id: 'members', header: 'الأعضاء', numeric: true, hideOnMobile: true, sortValue: (c) => c.members, cell: (c) => c.members },
    { id: 'patients', header: 'المرضى', numeric: true, sortValue: (c) => c.patients, cell: (c) => c.patients },
    { id: 'appointments', header: 'مواعيد آخر 30 يومًا', numeric: true, hideOnMobile: true, sortValue: (c) => c.appointments_30d, cell: (c) => c.appointments_30d },
    { id: 'login', header: 'آخر دخول', hideOnMobile: true, sortValue: (c) => c.last_login_at, cell: (c) => date(c.last_login_at) },
  ];
  return (
    <>
      <PageHeader title="العيادات" sub="كل العيادات على المنصة: الخطة والحالة والأرقام (بدون بيانات المرضى)." count={clinics.data?.length} />
      {clinics.data && (
        <StatusCards label="حالة العيادات" value={status} onChange={setStatus} items={[
          { value: 'all', label: 'كل العيادات', count: clinics.data.length, tone: 'neutral' },
          ...(['trialing', 'active', 'past_due', 'suspended'] as const).map((s) => ({ value: s, label: clinicStatusLabel[s], count: count(s), tone: STATUS_TONE[s] })),
        ]} />
      )}
      <DataTable
        label="العيادات"
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        isLoading={clinics.isLoading}
        error={clinics.isError ? clinics.error : undefined}
        onRetry={() => void clinics.refetch()}
        search={{ placeholder: 'اسم العيادة أو النطاق أو بريد المالك', text: (c) => [c.slug, c.name_ar, c.name_en, c.owner_email].filter(Boolean).join(' ') }}
        toolbar={(
          <Choice value={status} onChange={setStatus} label="الحالة" className="h-10 w-48 bg-card"
            options={['all', 'onboarding', 'trialing', 'active', 'past_due', 'suspended', 'cancelled'].map((s) => ({ value: s, label: s === 'all' ? 'كل الحالات' : (clinicStatusLabel[s]) }))} />
        )}
        pageSize={25}
        onRowClick={(c) => { window.location.hash = platformHref({ page: 'clinic', id: c.id }); }}
        empty={{ icon: <ShieldIcon size={28} />, title: 'لا عيادات مطابقة', text: 'غيّر البحث أو الحالة.' }}
      />
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
      <p><a href={platformHref({ page: 'clinics' })}>العيادات</a></p>
      <div className="page-head">
        <div>
          <h1><bdi>{clinicName(d)}</bdi> <Badge tone={STATUS_TONE[d.status] ?? 'neutral'}>{d.deletion ? 'بانتظار الحذف' : (clinicStatusLabel[d.status])}</Badge></h1>
          <p dir="ltr" className="muted">{d.slug} · {d.owner_email ?? '—'}</p>
        </div>
      </div>
      <div className="stats">
        {([['الأعضاء', d.members], ['الفروع', d.branches], ['المرضى', d.patients], ['مواعيد آخر 30 يومًا', d.appointments_30d]] as const).map(([k, v]) => (
          <div key={k} className="stat"><span className="stat-text"><small>{k}</small><strong>{v}</strong></span></div>
        ))}
      </div>
      {d.deletion && (
        <Card className="card-danger">
          <h2>طلب مالك العيادة حذفها</h2>
          <p className="mt-sm">{'طُلب الحذف في {asked}. تُمحى كل البيانات نهائيًا في {date} ما لم تُستعَد العيادة.'.replace('{asked}', date(d.deletion.requested_at)).replace('{date}', date(d.deletion.delete_after))}</p>
          <p className="muted small mt-sm">تعود العيادة كما كانت قبل طلب الحذف، ويستطيع فريقها الدخول من جديد.</p>
          <div className="mt"><Button loading={act.isPending && act.variables?.path === 'restore'} onClick={() => act.mutate({ path: 'restore' })}>استعادة العيادة</Button></div>
        </Card>
      )}
      <Card>
        <h2>الاشتراك</h2>
        <dl className="detail-list mt-sm">
          <div><dt>الخطة</dt><dd>{d.plan_name_ar ?? '—'}</dd></div>
          <div><dt>حالة الاشتراك</dt><dd>{d.subscription_status ? clinicStatusLabel[d.subscription_status] : '—'}</dd></div>
          {d.subscription_status === 'active' && <div><dt>نهاية الاشتراك الحالي</dt><dd>{date(d.current_period_end)} ({billingCycleLabel[d.billing_cycle ?? 'monthly']})</dd></div>}
          <div><dt>نهاية التجربة</dt><dd>{d.trial_ends_at ? `${date(d.trial_ends_at)}${left !== null ? ` (${left >= 0 ? 'باقي {n} يوم'.replace('{n}', String(left)) : 'انتهت التجربة'})` : ''}` : '—'}</dd></div>
          <div><dt>تاريخ التسجيل</dt><dd>{date(d.created_at)}</dd></div>
          <div><dt>آخر دخول</dt><dd>{date(d.last_login_at)}</dd></div>
        </dl>
        <div className="grid-2 mt">
          {d.subscription_status === 'trialing' && (
            <Field label="تمديد التجربة حتى">
              {(a) => (
                <div className="row-start">
                  <DatePicker id={a.id} value={until} onChange={setUntil} min={today} placeholder="اختر التاريخ" />
                  <Button variant="secondary" disabled={!until} loading={act.isPending && act.variables?.path === 'trial'}
                    onClick={() => act.mutate({ path: 'trial', body: { until } })}>حفظ</Button>
                </div>
              )}
            </Field>
          )}
          {(d.subscription_status === 'trialing' || d.subscription_status === 'past_due' || d.subscription_status === 'suspended') && (
            <Field label="تفعيل الاشتراك" hint="بعد أن تدفع العيادة: يبدأ الاشتراك اليوم لشهر أو سنة، ويرفع الإيقاف بسبب انتهاء التجربة.">
              {(a) => (
                <div className="row-start">
                  <Choice id={a.id} value={cycle} onChange={setCycle} options={(['monthly', 'yearly'] as const).map((c) => ({ value: c, label: billingCycleLabel[c] }))} />
                  <Button loading={act.isPending && act.variables?.path === 'activate'} onClick={() => act.mutate({ path: 'activate', body: { cycle } })}>تفعيل</Button>
                </div>
              )}
            </Field>
          )}
          <Field label="تغيير الخطة">
            {(a) => (
              <div className="row-start">
                <Choice id={a.id} value={planId} onChange={setPlanId} placeholder="اختر الخطة"
                  options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name_ar }))} />
                <Button variant="secondary" disabled={!planId} loading={act.isPending && act.variables?.path === 'plan'}
                  onClick={() => act.mutate({ path: 'plan', body: { planId } })}>حفظ</Button>
              </div>
            )}
          </Field>
        </div>
        <div className="row-end mt">
          {d.status === 'suspended'
            ? d.suspension_kind !== 'trial_ended' && <Button loading={act.isPending && act.variables?.path === 'reactivate'} onClick={() => act.mutate({ path: 'reactivate' })}>إعادة تفعيل العيادة</Button>
            : d.status !== 'cancelled' && <Button variant="secondary" onClick={() => { setReason(''); setSuspending(true); }}>إيقاف العيادة</Button>}
        </div>
        {d.status === 'suspended' && (
          <Alert tone="info">
            {d.suspension_kind === 'trial_ended' ? 'أوقفت العيادة تلقائيًا لانتهاء الفترة التجريبية دون تفعيل خطة. فعّل الاشتراك بعد الدفع، أو مدّد التجربة.' : 'العيادة موقوفة: فريقها لا يستطيع الدخول وموقعها متوقف.'}
            {d.suspension_kind === 'manual' && d.suspension_reason && <> السبب: <bdi>{d.suspension_reason}</bdi></>}
          </Alert>
        )}
        <ErrorText error={act.error} />
      </Card>
      <Card>
        <h2>ملاحظات المنصة</h2>
        <form className="stack mt-sm" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
          <Field label="ملاحظة جديدة (لا تراها العيادة)">{(a) => <TextArea id={a.id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />}</Field>
          <ErrorText error={addNote.error} />
          <div className="row-end"><Button type="submit" variant="secondary" loading={addNote.isPending} disabled={!note.trim()}>إضافة</Button></div>
        </form>
        <ul className="line-list mt">
          {d.notes.map((n) => <li key={n.id}><span><bdi>{n.body}</bdi><span className="muted small block">{n.author} · {when(n.created_at)}</span></span></li>)}
        </ul>
      </Card>
      <Card>
        <h2>سجل الإجراءات</h2>
        <AuditList rows={d.history} />
      </Card>
      <ConfirmDialog open={suspending} title="إيقاف العيادة" confirmLabel="إيقاف العيادة" danger
        onConfirm={() => { if (reason.trim().length >= 3) { setSuspending(false); act.mutate({ path: 'suspend', body: { reason: reason.trim() } }); } }}
        onCancel={() => setSuspending(false)}>
        <p>لن يستطيع فريق العيادة الدخول، وسيتوقف موقعها. تبقى البيانات كما هي، وإعادة التفعيل ترجع كل شيء.</p>
        <Field label="السبب" hint="3 أحرف على الأقل">{(a) => <Input id={a.id} describedBy={a.describedBy} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}</Field>
      </ConfirmDialog>
    </>
  );
}

function AuditList({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="muted small mt-sm">لا إجراءات بعد.</p>;
  return (
    <ul className="line-list mt-sm">
      {rows.map((r) => (
        <li key={r.id}>
          <span>
            <strong>{platformActionLabel[r.action.replace('.', '_')]}</strong>
            {typeof r.details?.reason === 'string' && <> — <bdi>{r.details.reason}</bdi></>}
            <span className="muted small block">{r.actor ?? 'النظام'} · {when(r.created_at)}</span>
          </span>
          {r.tenant_id && <span className="line-end"><a href={platformHref({ page: 'clinic', id: r.tenant_id })}>فتح العيادة</a></span>}
        </li>
      ))}
    </ul>
  );
}

function ActivityPage() {
  const audit = useQuery({ queryKey: [...KEY, 'audit'], queryFn: () => papi<AuditRow[]>('/platform/audit') });
  return (
    <>
      <PageHeader title="السجل" sub="كل ما فعله مديرو المنصة، الأحدث أولًا." />
      <Card>{audit.isError ? <ErrorText error={audit.error} /> : !audit.data ? <Skeleton h={48} count={4} /> : <AuditList rows={audit.data} />}</Card>
    </>
  );
}

// ---------- H7 requests from the landing page's contact form (LND-04) ----------
interface Lead {
  id: string; kind: 'call' | 'subscribe'; billing_cycle: 'monthly' | 'yearly' | null; clinic_id: string | null;
  full_name: string; phone: string; email: string | null; clinic_name: string | null; city: string | null; message: string | null;
  source: string | null; status: LeadStatus; plan_code: string | null; plan_name_ar: string | null; created_at: string; updated_at: string;
  updated_by_name: string | null;
}
const LEAD_TONE: Record<LeadStatus, 'neutral' | 'primary' | 'success' | 'warning'> = { new: 'primary', contacted: 'warning', converted: 'success', lost: 'neutral' };

function LeadsPage() {
  const qc = useQueryClient();
  const leads = useQuery({ queryKey: [...KEY, 'leads'], queryFn: () => papi<Lead[]>('/platform/leads') });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: LeadStatus }) => papi<Lead[]>(`/platform/leads/${id}/status`, { method: 'POST', body: JSON.stringify({ status: to }) }),
    onSuccess: (rows) => qc.setQueryData([...KEY, 'leads'], rows),
  });
  // search and status are the panel's own filter (it also matches phone numbers written either way); the table sorts and pages
  const rows = leads.data ? filterLeads(leads.data, q, status) : undefined;
  const count = (s: LeadStatus) => leads.data?.filter((l) => l.status === s).length ?? 0;
  const columns: Column<Lead>[] = [
    {
      id: 'person', header: 'صاحب الطلب', sortValue: (l) => l.full_name,
      cell: (l) => (
        <span className="pl-person">
          <span className="pl-avatar" aria-hidden>{initials(l.full_name)}</span>
          <span className="min-w-0">
            <strong className="block"><bdi>{l.full_name}</bdi></strong>
            {(l.clinic_name || l.city) && <span className="muted small block"><bdi>{[l.clinic_name, l.city].filter(Boolean).join(' · ')}</bdi></span>}
          </span>
        </span>
      ),
    },
    {
      id: 'kind', header: 'النوع', hideOnMobile: true, sortValue: (l) => l.kind,
      cell: (l) => (
        <Badge tone={l.kind === 'subscribe' ? 'success' : 'neutral'}>
          {l.kind === 'subscribe' ? `${'طلب اشتراك'} · ${l.billing_cycle === 'yearly' ? 'سنوي' : 'شهري'}` : 'طلب اتصال'}
        </Badge>
      ),
    },
    // two lines at most; the whole message is in the tooltip
    { id: 'message', header: 'الرسالة', hideOnMobile: true, cell: (l) => (l.message ? <span className="pl-message" title={l.message}><bdi>{l.message}</bdi></span> : <span className="muted">—</span>) },
    {
      id: 'contact', header: 'التواصل',
      cell: (l) => (
        <>
          <a href={`tel:${l.phone}`} dir="ltr" className="whitespace-nowrap">{l.phone}</a>
          {l.email && <a className="small block" href={`mailto:${l.email}`} dir="ltr">{l.email}</a>}
        </>
      ),
    },
    { id: 'plan', header: 'الخطة', hideOnMobile: true, sortValue: (l) => l.plan_name_ar, cell: (l) => l.plan_name_ar ?? '—' },
    {
      id: 'status', header: 'الحالة', sortValue: (l) => LEAD_STATUSES.indexOf(l.status),
      cell: (l) => (
        <>
          <Badge tone={LEAD_TONE[l.status]} dot>{leadStatusLabel[l.status]}</Badge>
          {l.updated_by_name && <span className="muted small block">{l.updated_by_name}</span>}
        </>
      ),
    },
    { id: 'received', header: 'وصل في', hideOnMobile: true, sortValue: (l) => l.created_at, cell: (l) => <span className="muted whitespace-nowrap">{when(l.created_at)}</span> },
  ];
  return (
    <>
      <PageHeader title="طلبات التواصل" sub="العيادات التي طلبت اتصالًا من صفحة المنصة، الأحدث أولًا. غيّر الحالة بعد كل خطوة." count={leads.data?.length} />
      {leads.data && (
        <StatusCards label="حالة الطلبات" value={status} onChange={setStatus} items={[
          { value: 'all', label: 'كل الطلبات', count: leads.data.length, tone: 'neutral' },
          ...LEAD_STATUSES.map((s) => ({ value: s, label: leadStatusLabel[s], count: count(s), tone: LEAD_TONE[s] })),
        ]} />
      )}
      {move.isError && <ErrorText error={move.error} />}
      <DataTable
        label="طلبات التواصل"
        rows={rows}
        columns={columns}
        rowKey={(l) => l.id}
        isLoading={leads.isLoading}
        error={leads.isError ? leads.error : undefined}
        onRetry={() => void leads.refetch()}
        search={{ placeholder: 'الاسم أو العيادة أو المدينة أو الرقم', value: q, onChange: setQ }}
        pageSize={25}
        isFetching={move.isPending}
        // reach the person, open their clinic, then move the request on (the status was a dropdown in every row)
        actions={(l) => (
          <RowMenu label={l.full_name} actions={[
            { label: 'اتصال', icon: <Phone className="size-4" />, onSelect: () => { window.location.href = `tel:${l.phone}`; } },
            { label: 'إرسال بريد', icon: <Mail className="size-4" />, hidden: !l.email, onSelect: () => { window.location.href = `mailto:${l.email}`; } },
            { label: 'صفحة العيادة', icon: <Building2 className="size-4" />, hidden: !l.clinic_id, onSelect: () => { window.location.hash = platformHref({ page: 'clinic', id: l.clinic_id! }); } },
            ...LEAD_STATUSES.filter((s) => s !== l.status).map((s) => ({ label: `${'نقل إلى'}: ${leadStatusLabel[s]}`, onSelect: () => move.mutate({ id: l.id, to: s }) })),
          ]} />
        )}
        empty={{ icon: <ShieldIcon size={28} />, title: 'لا توجد طلبات', text: 'تظهر هنا طلبات التواصل التي تصل من نموذج صفحة المنصة.' }}
      />
    </>
  );
}

// ---------- H6 legal documents ----------
interface LegalVersion { id: string; kind: string; version: number; title_ar: string; body_ar: string; requires_reacceptance: boolean; published_at: string; published_by: string | null; acceptances: number }
const LEGAL_KINDS = ['terms', 'privacy', 'dpa'] as const;

function LegalAdminPage() {
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: [...KEY, 'legal'], queryFn: () => papi<LegalVersion[]>('/platform/legal') });
  const [kind, setKind] = useState<string>('terms');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reaccept, setReaccept] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const publish = useMutation({
    mutationFn: () => papi<LegalVersion[]>('/platform/legal', { method: 'POST', body: JSON.stringify({ kind, titleAr: title.trim(), bodyAr: body.trim(), requiresReacceptance: reaccept }) }),
    onSuccess: (v) => { qc.setQueryData([...KEY, 'legal'], v); setTitle(''); setBody(''); setReaccept(false); },
  });
  const latest = (k: string) => versions.data?.find((v) => v.kind === k);
  const start = (k: string) => { setKind(k); const l = latest(k); setTitle(l?.title_ar ?? ''); setBody(l?.body_ar ?? ''); setReaccept(false); };
  const ok = title.trim().length >= 2 && body.trim().length >= 20;
  return (
    <>
      <PageHeader title="المستندات القانونية" sub="شروط الاستخدام وسياسة الخصوصية واتفاقية معالجة البيانات. كل نشر إصدار جديد؛ الإصدارات السابقة تبقى كما هي." />
      {versions.isError ? <ErrorText error={versions.error} /> : !versions.data ? <Skeleton h={64} count={3} /> : LEGAL_KINDS.map((k) => (
        <Card key={k}>
          <div className="row-between">
            <h2>{legalDocLabel[k]}</h2>
            <Button variant="secondary" onClick={() => start(k)}>إصدار جديد</Button>
          </div>
          {!versions.data.some((v) => v.kind === k) ? <p className="muted small mt-sm">لم يُنشر بعد. التسجيل لا يطلب الموافقة عليه حتى تنشره.</p> : (
            <ul className="line-list mt-sm">
              {versions.data.filter((v) => v.kind === k).map((v) => (
                <li key={v.id}>
                  <span>
                    <strong>{'الإصدار {n}'.replace('{n}', String(v.version))}</strong> — <bdi>{v.title_ar}</bdi>
                    {v.requires_reacceptance && <> <Badge tone="warning">تطلب الموافقة من جديد</Badge></>}
                    <span className="muted small block">{when(v.published_at)} · {v.published_by ?? '—'} · {'{n} موافقة'.replace('{n}', String(v.acceptances))}</span>
                  </span>
                  {v.id === latest(k)?.id && <span className="line-end"><a href={`#/legal/${k}`} target="_blank" rel="noopener noreferrer">قراءة</a></span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <Card as="form" className="stack">
        <h2>نشر إصدار جديد</h2>
        <p className="muted small">اكتب النص المعتمد من المحامي. لا يمكن تعديل إصدار بعد نشره؛ أي تغيير يكون إصدارًا جديدًا.</p>
        <div className="grid-2">
          <Field label="المستند">{(a) => <Choice id={a.id} value={kind} onChange={start} options={LEGAL_KINDS.map((k) => ({ value: k, label: legalDocLabel[k] }))} />}</Field>
          <Field label="العنوان">{(a) => <Input id={a.id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}</Field>
        </div>
        <Field label="النص" hint="نص عادي؛ اترك سطرًا فارغًا بين الفقرات.">{(a) => <TextArea id={a.id} describedBy={a.describedBy} value={body} onChange={(e) => setBody(e.target.value)} rows={16} />}</Field>
        <Switch checked={reaccept} onChange={setReaccept} label="يجب على من وافق على الإصدار السابق أن يوافق من جديد عند دخوله التالي" />
        <ErrorText error={publish.error} />
        <div className="row-end"><Button disabled={!ok} loading={publish.isPending} onClick={() => setConfirming(true)}>نشر</Button></div>
      </Card>
      <ConfirmDialog open={confirming} title="نشر إصدار جديد" confirmLabel="نشر" danger={reaccept}
        onConfirm={() => { setConfirming(false); publish.mutate(); }} onCancel={() => setConfirming(false)}>
        <p>{reaccept ? 'كل من وافق على إصدار سابق لن يستطيع استخدام النظام حتى يوافق على هذا الإصدار عند دخوله التالي.' : 'سيسري الإصدار الجديد على التسجيلات الجديدة. من وافق سابقًا لن يُطلب منه شيء.'}</p>
      </ConfirmDialog>
    </>
  );
}

// ---------- ADM-04 plans ----------
function PlansPage() {
  const plans = useQuery({ queryKey: [...KEY, 'plans'], queryFn: () => papi<Plan[]>('/platform/plans') });
  return (
    <>
      <PageHeader title="الخطط" sub="أسعار الخطط ومدة التجربة والحدود والمزايا. التغيير يسري على كل عيادة على الخطة." />
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
      <div className="row-between"><h2>{p.name_ar} <span className="muted small" dir="ltr">({p.code})</span></h2><span className="muted small">{'{n} عيادة على هذه الخطة'.replace('{n}', String(p.clinics))}</span></div>
      <div className="grid-2">
        <Field label="اسم الخطة">{(a) => <Input id={a.id} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={60} />}</Field>
        <Field label="أيام التجربة">{(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={trial} onChange={(e) => { setTrial(e.target.value); setSaved(false); }} />}</Field>
        <Field label={`${'السعر الشهري'} (${money(0, p.currency).replace(/^0\s*/, '')})`}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={monthly} onChange={(e) => { setMonthly(e.target.value); setSaved(false); }} invalid={m === null} />}</Field>
        <Field label={`${'السعر السنوي'} (${money(0, p.currency).replace(/^0\s*/, '')})`}>{(a) => <Input id={a.id} dir="ltr" inputMode="decimal" value={yearly} onChange={(e) => { setYearly(e.target.value); setSaved(false); }} invalid={y === null} />}</Field>
      </div>
      <h3>الحدود</h3>
      <p className="muted small">اتركه فارغًا لعدد غير محدود. الحد يسري على ما يُضاف بعد التغيير.</p>
      <div className="grid-2">
        {LIMIT_KEYS.map((k) => (
          <Field key={k} label={planLimitLabel[k]}>
            {(a) => <Input id={a.id} dir="ltr" inputMode="numeric" value={limits[k]} placeholder="غير محدود" onChange={(e) => { setLimits((l) => ({ ...l, [k]: e.target.value })); setSaved(false); }} />}
          </Field>
        ))}
      </div>
      <h3>المزايا</h3>
      {FEATURE_KEYS.map((k) => <Switch key={k} checked={features[k]} label={planFeatureLabel[k]} onChange={(v) => { setFeatures((f) => ({ ...f, [k]: v })); setSaved(false); }} />)}
      <Switch checked={isPublic} label="تظهر في صفحة الأسعار" onChange={(v) => { setPublic(v); setSaved(false); }} />
      {saved && <Alert tone="success">تم الحفظ</Alert>}
      <ErrorText error={save.error} />
      <div className="row-end"><Button onClick={() => save.mutate()} disabled={!ok} loading={save.isPending}>حفظ</Button></div>
    </Card>
  );
}

