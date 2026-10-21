import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api, type Session } from '../../api';
import { navigate, useFlash } from '../../hooks';
import { roleLabel } from '../../labels';
import { keys, useBranches, useInvitations, useMembers } from '../../queries';
import { to } from '../../router';
import type { Branch, StaffInvitation, StaffMember } from '../../types';
import { DataTable, type Column } from '../../ui/data-table';
import { Alert, Badge, Button, ErrorText, PageHeader } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { Mail } from 'lucide-react';
import { EditIcon, PlusIcon, ShieldIcon } from '../../ui/icons';
import { RowMenu } from '../../ui/row-menu';

const branchNames = (ids: string[], branches: Branch[] | undefined) =>
  ids.map((id) => branches?.find((b) => b.id === id)).filter(Boolean).map((b) => arName(b!.name_ar, b!.name_en, b!.slug)).join('، ');

/** `#/staff`: members and open invitations (owner only, `staff:manage`). */
export function StaffList({ clinicId, session }: { clinicId: string; session: Session }) {
  const flash = useFlash();
  const members = useMembers(clinicId);
  const invitations = useInvitations(clinicId);
  const branches = useBranches(clinicId).data;
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<StaffInvitation | null>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.staff(clinicId) });
  // one resend and one revoke for the table (U2): their errors and notices show above it
  const resend = useMutation({ mutationFn: (id: string) => api(`/staff/invitations/${id}/resend`, { method: 'POST' }), onSuccess: () => { setNotice('أُرسل رابط جديد، والرابط القديم لم يعد يعمل.'); void refresh(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/staff/invitations/${id}/revoke`, { method: 'POST' }), onSuccess: () => { setNotice('أُلغيت الدعوة.'); void refresh(); } });
  const addBtn = <Button onClick={() => navigate(to.create('staff'))}><PlusIcon size={18} />دعوة عضو</Button>;

  return (
    <>
      <PageHeader title="فريق العمل" sub="أعضاء العيادة وأدوارهم والفروع التي يعملون بها" action={addBtn} />
      {(flash || notice) && <Alert tone="success">{notice ?? flash}</Alert>}

      <h2 className="section-title">الأعضاء</h2>
      <DataTable
        label="الأعضاء"
        rows={members.data}
        columns={memberColumns(branches, session.user.email)}
        rowKey={(m) => m.id}
        isLoading={members.isLoading}
        isFetching={members.isFetching}
        error={members.isError ? members.error : undefined}
        onRetry={() => void members.refetch()}
        search={{ placeholder: 'ابحث بالاسم أو البريد أو الوظيفة', text: (m) => [m.user.full_name, m.user.email, m.job_title, roleLabel(m.role.key, m.role.name_ar)].filter(Boolean).join(' ') }}
        actions={(m) => <RowMenu label={m.user.full_name} actions={[{ label: 'تعديل', icon: <EditIcon size={16} />, route: to.edit('staff', m.id) }]} />}
        onRowClick={(m) => navigate(to.edit('staff', m.id))}
        empty={{ icon: <ShieldIcon size={28} />, title: 'الأعضاء', text: 'أعضاء العيادة وأدوارهم والفروع التي يعملون بها' }}
      />

      <h2 className="section-title mt">دعوات لم تُقبل بعد</h2>
      <ErrorText error={resend.error ?? revoke.error} />
      <DataTable
        label="دعوات لم تُقبل بعد"
        rows={invitations.data}
        columns={invitationColumns(branches)}
        rowKey={(i) => i.id}
        isLoading={invitations.isLoading}
        isFetching={invitations.isFetching || resend.isPending || revoke.isPending}
        error={invitations.isError ? invitations.error : undefined}
        onRetry={() => void invitations.refetch()}
        actions={(i) => (
          <RowMenu label={i.email} actions={[
            { label: 'إرسال رابط جديد', icon: <Mail size={16} aria-hidden />, onSelect: () => resend.mutate(i.id) },
            { label: 'إلغاء الدعوة', destructive: true, onSelect: () => setRevoking(i) },
          ]} />
        )}
        empty={{ icon: <ShieldIcon size={28} />, title: 'لا توجد دعوات معلقة.', text: 'نرسل رابطًا إلى بريده الإلكتروني صالحًا لمدة 7 أيام. يختار كلمة المرور بنفسه.' }}
      />
      <ConfirmDialog open={!!revoking} title="إلغاء الدعوة" confirmLabel="إلغاء الدعوة" danger
        onConfirm={() => { if (revoking) revoke.mutate(revoking.id); setRevoking(null); }} onCancel={() => setRevoking(null)}>
        سيتوقف رابط الدعوة عن العمل فورًا.
      </ConfirmDialog>
    </>
  );
}

/** The members table (redesign R4): who, what they do, where, their role and whether they can sign in. */
function memberColumns(branches: Branch[] | undefined, myEmail: string | null): Column<StaffMember>[] {
  return [
    {
      id: 'member', header: 'العضو', sortValue: (m) => m.user.full_name,
      cell: (m) => (
        <span className="patient-main">
          <span className="patient-avatar" aria-hidden>{m.user.full_name.trim().slice(0, 1)}</span>
          <span className="patient-text">
            <strong><bdi>{m.user.full_name}</bdi>{m.user.email === myEmail && <> · <span className="muted">أنت</span></>}</strong>
            <bdi dir="ltr" className="muted small">{m.user.email}</bdi>
          </span>
        </span>
      ),
    },
    {
      id: 'job', header: 'الوظيفة', hideOnMobile: true,
      cell: (m) => (
        <>
          {m.job_title ? <bdi>{m.job_title}</bdi> : <span className="muted">—</span>}
          {m.doctor && <span className="muted small block">طبيب: <bdi>{arName(m.doctor.name_ar, m.doctor.name_en, '')}</bdi></span>}
        </>
      ),
    },
    { id: 'branches', header: 'الفروع', hideOnMobile: true, cell: (m) => (m.all_branches ? 'كل الفروع' : <bdi>{branchNames(m.branch_ids, branches)}</bdi>) },
    {
      id: 'role', header: 'الدور', sortValue: (m) => roleLabel(m.role.key, m.role.name_ar),
      cell: (m) => (
        <span className="patient-badges">
          <Badge tone={m.role.key === 'owner' ? 'primary' : 'neutral'}>{roleLabel(m.role.key, m.role.name_ar)}</Badge>
          {m.status === 'disabled' && <Badge tone="warning" dot>موقوف</Badge>}
        </span>
      ),
    },
  ];
}

/** The invitations table: who was invited, as what, where, and until when the link works. */
function invitationColumns(branches: Branch[] | undefined): Column<StaffInvitation>[] {
  const expires = (iso: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }).format(new Date(iso));
  return [
    {
      id: 'email', header: 'البريد الإلكتروني', sortValue: (i) => i.email,
      cell: (i) => (
        <span className="patient-main">
          <span className="patient-avatar" aria-hidden>@</span>
          <span className="patient-text"><strong><bdi dir="ltr">{i.email}</bdi></strong>{i.invited_by && <span className="muted small">أرسلها: <bdi>{i.invited_by}</bdi></span>}</span>
        </span>
      ),
    },
    {
      id: 'role', header: 'الدور', sortValue: (i) => roleLabel(i.role.key, i.role.name_ar),
      cell: (i) => (
        <span className="patient-badges">
          <Badge>{roleLabel(i.role.key, i.role.name_ar)}</Badge>
          {i.expired && <Badge tone="warning" dot>انتهت صلاحيتها</Badge>}
        </span>
      ),
    },
    { id: 'branches', header: 'الفروع', hideOnMobile: true, cell: (i) => (i.branch_ids.length ? <bdi>{branchNames(i.branch_ids, branches)}</bdi> : 'كل الفروع') },
    { id: 'expires', header: 'تنتهي', hideOnMobile: true, sortValue: (i) => i.expires_at, cell: (i) => <span className="whitespace-nowrap">{expires(i.expires_at)}</span> },
  ];
}
