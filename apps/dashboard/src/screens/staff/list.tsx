import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api, type Session } from '../../api';
import { navigate, useFlash } from '../../hooks';
import { roleLabel, t, type Lang } from '../../i18n';
import { keys, useBranches, useInvitations, useMembers } from '../../queries';
import { to } from '../../router';
import type { Branch, StaffInvitation, StaffMember } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, LinkButton, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { EditIcon, PlusIcon, ShieldIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';

const branchNames = (ids: string[], branches: Branch[] | undefined, lang: Lang) =>
  ids.map((id) => branches?.find((b) => b.id === id)).filter(Boolean).map((b) => pickName(lang, b!.name_ar, b!.name_en, b!.slug)).join('، ');

/** `#/staff`: members and open invitations (owner only, `staff:manage`). */
export function StaffList({ lang, clinicId, session }: { lang: Lang; clinicId: string; session: Session }) {
  const flash = useFlash();
  const members = useMembers(clinicId);
  const invitations = useInvitations(clinicId);
  const branches = useBranches(clinicId).data;
  const [notice, setNotice] = useState<string | null>(null);
  const addBtn = <Button onClick={() => navigate(to.create('staff'))}><PlusIcon size={18} />{t('inviteStaff', lang)}</Button>;

  return (
    <>
      <PageHeader title={t('navStaff', lang)} sub={t('staffSub', lang)} action={addBtn} />
      {(flash || notice) && <Alert tone="success">{notice ?? flash}</Alert>}

      <h2 className="section-title">{t('members', lang)}</h2>
      {members.isError ? <ErrorText error={members.error} onRetry={() => void members.refetch()} />
        : members.isLoading ? <Skeleton h={72} count={3} />
        : (
          <ul className="patient-rows" aria-busy={members.isFetching || undefined}>
            {members.data?.map((m) => <MemberRow key={m.id} m={m} lang={lang} branches={branches} isYou={m.user.email === session.user.email} />)}
          </ul>
        )}

      <h2 className="section-title mt">{t('pendingInvites', lang)}</h2>
      {invitations.isError ? <ErrorText error={invitations.error} onRetry={() => void invitations.refetch()} />
        : invitations.isLoading ? <Skeleton h={72} count={1} />
        : !invitations.data?.length ? <Card><EmptyState icon={<ShieldIcon size={28} />} title={t('noInvites', lang)} text={t('inviteSub', lang)} /></Card>
        : (
          <ul className="patient-rows">
            {invitations.data.map((i) => <InvitationRow key={i.id} inv={i} lang={lang} clinicId={clinicId} branches={branches} onDone={setNotice} />)}
          </ul>
        )}
    </>
  );
}

function MemberRow({ m, lang, branches, isYou }: { m: StaffMember; lang: Lang; branches: Branch[] | undefined; isYou: boolean }) {
  return (
    <Card as="li" className="patient-row">
      <span className="patient-main">
        <span className="patient-avatar" aria-hidden>{m.user.full_name.trim().slice(0, 1)}</span>
        <span className="patient-text">
          <strong><bdi>{m.user.full_name}</bdi>{isYou && <> · <span className="muted">{t('you', lang)}</span></>}</strong>
          <span className="muted small">
            <bdi dir="ltr">{m.user.email}</bdi>
            {m.job_title && <> · <bdi>{m.job_title}</bdi></>}
            {' · '}{m.all_branches ? t('allBranchesLabel', lang) : <bdi>{branchNames(m.branch_ids, branches, lang)}</bdi>}
            {m.doctor && <> · {t('doctorPrefix', lang)} <bdi>{pickName(lang, m.doctor.name_ar, m.doctor.name_en, '')}</bdi></>}
          </span>
        </span>
      </span>
      <span className="patient-badges">
        <Badge tone={m.role.key === 'owner' ? 'primary' : 'neutral'}>{roleLabel(m.role.key, lang)}</Badge>
        {m.status === 'disabled' && <Badge tone="warning">{t('memberDisabled', lang)}</Badge>}
      </span>
      <RouteLink route={to.edit('staff', m.id)} className="btn btn-secondary btn-sm"><EditIcon size={16} />{t('edit', lang)}</RouteLink>
    </Card>
  );
}

function InvitationRow({ inv, lang, clinicId, branches, onDone }: {
  inv: StaffInvitation; lang: Lang; clinicId: string; branches: Branch[] | undefined; onDone: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.staff(clinicId) });
  const resend = useMutation({ mutationFn: () => api(`/staff/invitations/${inv.id}/resend`, { method: 'POST' }), onSuccess: () => { onDone(t('inviteResent', lang)); void refresh(); } });
  const revoke = useMutation({ mutationFn: () => api(`/staff/invitations/${inv.id}/revoke`, { method: 'POST' }), onSuccess: () => { onDone(t('inviteRevoked', lang)); void refresh(); } });
  const expires = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', { dateStyle: 'medium' }).format(new Date(inv.expires_at));
  return (
    <Card as="li" className="patient-row">
      <span className="patient-main">
        <span className="patient-avatar" aria-hidden>@</span>
        <span className="patient-text">
          <strong><bdi dir="ltr">{inv.email}</bdi></strong>
          <span className="muted small">
            {inv.branch_ids.length ? <bdi>{branchNames(inv.branch_ids, branches, lang)}</bdi> : t('allBranchesLabel', lang)}
            {inv.invited_by && <> · {t('invitedBy', lang)}: <bdi>{inv.invited_by}</bdi></>}
            {' · '}{t('expiresOn', lang)}: {expires}
          </span>
        </span>
      </span>
      <span className="patient-badges">
        <Badge>{roleLabel(inv.role.key, lang)}</Badge>
        {inv.expired && <Badge tone="warning">{t('expiredBadge', lang)}</Badge>}
      </span>
      <span className="row-end">
        <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>{t('resendInvite', lang)}</Button>
        <LinkButton onClick={() => setConfirm(true)}>{t('revokeInvite', lang)}</LinkButton>
      </span>
      <ErrorText error={resend.error ?? revoke.error} />
      <ConfirmDialog open={confirm} title={t('revokeInvite', lang)} confirmLabel={t('revokeInvite', lang)} danger
        onConfirm={() => { setConfirm(false); revoke.mutate(); }} onCancel={() => setConfirm(false)}>
        {t('revokeInviteText', lang)}
      </ConfirmDialog>
    </Card>
  );
}
