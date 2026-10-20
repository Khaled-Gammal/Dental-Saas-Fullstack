import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, logout, setLoginNotice, type Session } from '../api';
import { confirmsClinic, downloadable, EXPORT_TONE, exportBusy, sizeText, type ExportRow } from '../clinic-data-model';
import { exportStatusLabel } from '../labels';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, PasswordInput, Skeleton } from '../ui/components';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { AlertIcon, ShieldIcon } from '../ui/icons';

const KEY = ['clinic-data', 'exports'] as const;
const when = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long' }).format(new Date(iso));

/**
 * `#/data` (H8, NFR-08; owner only): export all the clinic's data, and delete the clinic. Both ask for the owner's
 * password again; deleting also asks for the clinic's name typed out, then a last confirmation.
 */
export function ClinicData({ session }: { session: Session }) {
  return (
    <>
      <PageHeader title="بيانات العيادة" sub="تصدير كل بيانات العيادة، وحذف العيادة. لمالك العيادة فقط." />
      <ExportCard />
      <DeleteCard session={session} />
    </>
  );
}

function ExportCard() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: KEY, queryFn: () => api<ExportRow[]>('/clinic/data/exports'),
    refetchInterval: (q) => (exportBusy(q.state.data ?? []) ? 5_000 : false), // until the worker has finished it
  });
  const [password, setPassword] = useState('');
  const request = useMutation({
    mutationFn: () => api<ExportRow[]>('/clinic/data/exports', { method: 'POST', body: JSON.stringify({ password }) }),
    onSuccess: (rows) => { qc.setQueryData(KEY, rows); setPassword(''); },
  });
  const link = useMutation({
    mutationFn: (id: string) => api<{ url: string }>(`/clinic/data/exports/${id}/link`, { method: 'POST' }),
    onSuccess: ({ url }) => { window.location.assign(url); }, // a ZIP: the browser downloads it and stays on this page
  });
  const rows = list.data ?? [];
  const busy = exportBusy(rows);

  return (
    <Card>
      <h2>تصدير البيانات</h2>
      <p className="muted">ملف ZIP واحد فيه كل بيانات العيادة: ملف يفتح في Excel (CSV) لكل نوع من البيانات، ونسخة JSON لنقلها إلى نظام آخر، وكل الملفات المرفوعة. يُجهَّز في الخلفية ويصلك بريد عند جاهزيته، ويبقى متاحًا للتنزيل 7 أيام.</p>
      <form className="row-form mt" onSubmit={(e) => { e.preventDefault(); if (password) request.mutate(); }}>
        <Field label="كلمة المرور" hint="نطلبها مرة أخرى لأن الملف يحتوي على بيانات كل المرضى.">
          {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            showLabel="إظهار كلمة المرور" hideLabel="إخفاء كلمة المرور" required maxLength={128} disabled={busy} />}
        </Field>
        <Button type="submit" loading={request.isPending} disabled={busy || !password}>{busy ? 'جارٍ التجهيز…' : 'جهّز نسخة من البيانات'}</Button>
      </form>
      <ErrorText error={request.error} />
      <ErrorText error={link.error} />
      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : !list.data ? <Skeleton h={48} count={2} />
        : !rows.length ? <EmptyState icon={<ShieldIcon size={28} />} title="لا توجد نسخ بعد" text="جهّز نسخة لتحفظ بيانات عيادتك عندك." />
        : (
          <ul className="line-list mt">
            {rows.map((r) => (
              <li key={r.id}>
                <span>
                  <Badge tone={EXPORT_TONE[r.status]}>{exportStatusLabel[r.status]}</Badge>{' '}
                  <span className="small">{when(r.created_at)}</span>
                  {r.status === 'ready' && (
                    <span className="muted small block">
                      {sizeText(r.size_bytes)} · {'{n} ملف'.replace('{n}', String(r.files_count ?? 0))}
                      {r.expires_at && <> · {'متاحة حتى {date}'.replace('{date}', day(r.expires_at))}</>}
                    </span>
                  )}
                  {r.status === 'failed' && <span className="muted small block">حاول مرة أخرى؛ إن تكرر ذلك فتواصل مع إدارة المنصة.</span>}
                </span>
                {downloadable(r) && (
                  <span className="line-end">
                    <Button variant="secondary" loading={link.isPending && link.variables === r.id} onClick={() => link.mutate(r.id)}>تنزيل</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function DeleteCard({ session }: { session: Session }) {
  const clinic = { nameAr: session.clinic.nameAr, nameEn: session.clinic.nameEn, slug: session.clinic.slug };
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api<{ deleteAfter: string }>('/clinic/data/delete', { method: 'POST', body: JSON.stringify({ password, confirmName: name }) }),
    onSuccess: async ({ deleteAfter }) => {
      setLoginNotice('أُغلقت العيادة. ستُمحى بياناتها نهائيًا في {date}، وحتى ذلك اليوم يمكن استعادتها بالتواصل مع إدارة المنصة.'.replace('{date}', day(deleteAfter)));
      await logout();
    },
  });
  const ready = confirmsClinic(name, clinic) && password.length > 0;

  return (
    <Card className="card-danger">
      <h2>حذف العيادة</h2>
      <Alert tone="danger">
        <strong>الحذف يغلق العيادة فورًا:</strong>
        <ul className="mt-sm">
          <li>لا يستطيع أحد من فريقك الدخول، ويتوقف موقع العيادة الإلكتروني.</li>
          <li>تبقى البيانات محفوظة 90 يومًا، ويمكن استعادتها كما هي بالتواصل مع إدارة المنصة.</li>
          <li>بعد 90 يومًا تُمحى كل البيانات والملفات نهائيًا ولا يمكن استرجاعها.</li>
        </ul>
      </Alert>
      <p className="muted mt-sm">جهّز نسخة من البيانات ونزّلها قبل الحذف: بعد الحذف لن تستطيع الدخول لتنزيلها.</p>
      <form className="stack mt" onSubmit={(e) => { e.preventDefault(); if (ready) setConfirming(true); }}>
        <Field label={'للتأكيد اكتب اسم العيادة: «{name}»'.replace('{name}', clinic.nameAr || clinic.nameEn || clinic.slug)}>
          {(a) => <Input id={a.id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" dir="auto" maxLength={200} />}
        </Field>
        <Field label="كلمة المرور">
          {(a) => <PasswordInput id={a.id} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            showLabel="إظهار كلمة المرور" hideLabel="إخفاء كلمة المرور" maxLength={128} />}
        </Field>
        <ErrorText error={del.error} />
        <div><Button type="submit" variant="danger" disabled={!ready} loading={del.isPending}><AlertIcon size={16} /> حذف العيادة</Button></div>
      </form>
      <ConfirmDialog open={confirming} title="حذف العيادة" confirmLabel="نعم، احذف العيادة" danger
        onConfirm={() => { setConfirming(false); del.mutate(); }} onCancel={() => setConfirming(false)}>
        <p>ستُغلق العيادة الآن لكل فريقها، وتُمحى بياناتها بعد 90 يومًا. هل أنت متأكد؟</p>
      </ConfirmDialog>
    </Card>
  );
}
