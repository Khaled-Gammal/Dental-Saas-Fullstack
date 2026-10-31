import { useState } from 'react';
import { activityText, byDay, changeLines, ENTITY_FILTER, isView, periodRange, type ChangeValue, type Period } from '../../activity-model';
import { Choice } from '../../components/choice';
import { DatePicker } from '../../components/date-picker';
import { money } from '../../money';
import { useActivity, useActivityActors, useProfile } from '../../queries';
import { to } from '../../router';
import type { ActivityItem } from '../../types';
import { Badge, Button, Card, EmptyState, ErrorText, PageHeader, Skeleton } from '../../ui/components';
import { RouteLink } from '../../ui/page';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'اليوم' }, { value: 'week', label: 'آخر 7 أيام' }, { value: 'month', label: 'آخر 30 يومًا' }, { value: 'custom', label: 'فترة أخرى' },
];
const KINDS = [{ value: 'all', label: 'الكل' }, { value: 'changes', label: 'التعديلات' }, { value: 'views', label: 'مرات الفتح' }] as const;

/**
 * `#/activity` (Phase 2D, DSH-15): the clinic's activity log — who changed or opened what, and when. For whoever the
 * owner gives «سجل التغييرات» (audit:read) and who works in every branch. Read-only. Text people typed (reasons, notes)
 * shows only as "changed"; a record's name, link and changes show to those who may see that kind of record.
 */
export function ActivityLog({ clinicId }: { clinicId: string }) {
  const profile = useProfile(clinicId);
  const tz = profile.data?.timezone || 'Africa/Cairo';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const [period, setPeriod] = useState<Period>('week');
  const [custom, setCustom] = useState({ from: today, to: today });
  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');
  const [kind, setKind] = useState<'all' | 'changes' | 'views'>('all');
  const range = period === 'custom' ? custom : periodRange(period, today);
  const list = useActivity(clinicId, { ...range, actor, entity, kind });
  const actors = useActivityActors(clinicId);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
  const whenFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
  const stale = list.isPlaceholderData;
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const groups = byDay(items, (iso) => dayKey.format(new Date(iso)));
  const filtered = !!actor || !!entity || kind !== 'all';

  return (
    <>
      <PageHeader title="سجل العمليات" sub="من عدّل أو فتح ماذا ومتى: المرضى والمواعيد والفواتير والمدفوعات والفريق والإعدادات." />
      <div className="filter-bar">
        <Choice value={period} onChange={(v) => setPeriod(v as Period)} label="الفترة" className="h-10 min-w-36 bg-card" options={PERIODS} />
        {period === 'custom' && (
          <>
            <DatePicker value={custom.from} onChange={(v) => setCustom((c) => ({ from: v, to: v > c.to ? v : c.to }))} max={today} label="من" placeholder="من" />
            <DatePicker value={custom.to} onChange={(v) => setCustom((c) => ({ from: v < c.from ? v : c.from, to: v }))} max={today} label="إلى" placeholder="إلى" />
          </>
        )}
        <Choice value={actor} onChange={setActor} label="المستخدم" noneLabel="كل المستخدمين" className="h-10 min-w-40 bg-card"
          options={(actors.data ?? []).map((a) => ({ value: a.userId, label: a.active ? a.name : `${a.name} (سابق)` }))} />
        <Choice value={entity} onChange={setEntity} label="النوع" noneLabel="كل الأنواع" className="h-10 min-w-40 bg-card" options={ENTITY_FILTER} />
        <div className="seg" role="group" aria-label="نوع العملية">
          {KINDS.map((k) => (
            <button key={k.value} type="button" className={`seg-btn${kind === k.value ? ' is-on' : ''}`} aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>{k.label}</button>
          ))}
        </div>
      </div>

      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : list.isLoading ? <Card><Skeleton h={56} count={6} /></Card>
          : items.length === 0 ? <Card><EmptyState icon={<span aria-hidden>—</span>} title="لا توجد عمليات في هذه الفترة" text={filtered ? 'جرّب إزالة الفلاتر أو اختيار فترة أطول.' : 'اختر فترة أطول.'} /></Card>
            : (
              <div className={`actlog${stale ? ' is-stale' : ''}`} aria-busy={list.isFetching || undefined}>
                {groups.map((g) => (
                  <section key={g.day} className="actlog-day" aria-label={dayFmt.format(new Date(g.items[0].at))}>
                    <h2 className="actlog-day-title">{dayFmt.format(new Date(g.items[0].at))}</h2>
                    <Card as="div" className="actlog-card">
                      <ol className="actlog-list">
                        {g.items.map((it) => <Row key={it.id} item={it} time={timeFmt.format(new Date(it.at))} when={whenFmt} />)}
                      </ol>
                    </Card>
                  </section>
                ))}
              </div>
            )}
      {list.hasNextPage && !stale && <div className="row-center mt"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>عرض المزيد</Button></div>}
    </>
  );
}

function Row({ item, time, when }: { item: ActivityItem; time: string; when: Intl.DateTimeFormat }) {
  const [open, setOpen] = useState(false);
  const { lines, others } = changeLines(item.changes, item.entityType, item.action);
  const hasDetails = lines.length > 0 || others > 0 || !!item.ip;
  const who = item.actorName ?? (item.actorType === 'patient' ? 'المريض (من الموقع)' : item.actorType === 'system' ? 'النظام' : '—');
  const label = item.entityLabel && <bdi>{item.entityLabel}</bdi>;
  return (
    <li className={`actlog-row${isView(item.action) ? ' is-view' : ''}`}>
      <span className="actlog-time">{time}</span>
      <div className="actlog-main">
        <p>
          <strong><bdi>{who}</bdi></strong> {activityText(item.action, item.entityType)}
          {label && <> — {item.patientId ? <RouteLink route={to.view('patients', item.patientId)} className="link-btn">{label}</RouteLink> : label}</>}
          {isView(item.action) && <> <Badge>فتح</Badge></>}
        </p>
        {hasDetails && (
          <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'إخفاء التفاصيل' : 'التفاصيل'}</button>
        )}
        {open && (
          <dl className="actlog-changes">
            {lines.map((l) => (
              <div key={l.field}>
                <dt>{l.field}</dt>
                <dd>
                  {l.secret ? <span className="muted">تغيّر (النص نفسه لا يظهر في السجل)</span>
                    : l.from ? <><Value v={l.from} when={when} /> <span aria-hidden>←</span><span className="sr-only">إلى</span> <Value v={l.to} when={when} /></>
                      : <Value v={l.to} when={when} />}
                </dd>
              </div>
            ))}
            {others > 0 && <div><dt>بيانات أخرى</dt><dd className="muted">{others === 1 ? 'تغيّر حقل واحد آخر' : `تغيّرت ${others} حقول أخرى`}</dd></div>}
            {item.ip && <div><dt>عنوان الجهاز</dt><dd><bdi dir="ltr">{item.ip}</bdi></dd></div>}
          </dl>
        )}
      </div>
    </li>
  );
}

/** One value; times in the clinic's time zone (`when`), like the rows. */
function Value({ v, when }: { v: ChangeValue; when: Intl.DateTimeFormat }) {
  switch (v.kind) {
    case 'empty': return <span className="muted">فارغ</span>;
    case 'changed': return <span className="muted">تغيّر</span>;
    case 'money': return <span>{money(v.minor)}</span>;
    case 'time': return <span>{when.format(new Date(v.iso))}</span>;
    default: return <bdi className="actlog-value">{v.text}</bdi>;
  }
}
