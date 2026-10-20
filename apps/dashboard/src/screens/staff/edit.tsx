import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Choice } from '../../components/choice';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { roleLabel, t } from '../../i18n';
import { keys, useBranches, useMembers, useOne, useRoles } from '../../queries';
import { to } from '../../router';
import { roleOptions } from '../../roles-model';
import { memberForm, toMemberPatch, type MemberForm } from '../../staff-model';
import type { Branch, StaffMember, StaffRole } from '../../types';
import { Card, Field, Input, Switch } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { FormPage, ResourceState } from '../../ui/page';
import { BranchAccess } from './invite';

/** `#/staff/<id>/edit`: role, branches, job title, and whether the member can sign in (SRS ACCESS-002). */
export function StaffEdit({ clinicId, id, has }: { clinicId: string; id?: string; has: (p: string) => boolean }) {
  const one = useOne(useMembers(clinicId), id);
  const roles = useRoles(clinicId);
  const branches = useBranches(clinicId);
  if (!one.data) return <ResourceState {...one} back={to.list('staff')} backLabel={t('navStaff')} />;
  if (!roles.data || !branches.data) {
    const q = roles.isError ? roles : branches;
    return <ResourceState isLoading={!q.isError} isError={q.isError} error={q.error} notFound={false} refetch={() => void q.refetch()} back={to.list('staff')} backLabel={t('navStaff')} />;
  }
  return <EditBody key={one.data.id} clinicId={clinicId} member={one.data} roles={roles.data} branches={branches.data.filter((b) => b.is_active)} has={has} />;
}

function EditBody({ clinicId, member, roles, branches, has }: { clinicId: string; member: StaffMember; roles: StaffRole[]; branches: Branch[]; has: (p: string) => boolean }) {
  const [orig] = useState(() => memberForm(member)); // frozen baseline: a refetch cannot make the form dirty
  const [form, setForm] = useState<MemberForm>(orig);
  const [confirmOff, setConfirmOff] = useState(false);
  const qc = useQueryClient();
  const leave = useLeave(to.list('staff'));
  const body = toMemberPatch(form, orig);
  const dirty = Object.keys(body).length > 0;
  const canSave = dirty && (form.allBranches || form.branchIds.length > 0);
  useUnsavedChanges(dirty, t('leaveUnsaved'));
  const set = <K extends keyof MemberForm>(k: K) => (v: MemberForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleBranch = (bid: string, on: boolean) => set('branchIds')(on ? [...form.branchIds, bid] : form.branchIds.filter((x) => x !== bid));

  const save = useMutation({
    mutationFn: () => api<StaffMember>(`/staff/members/${member.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.staff(clinicId) }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (canSave) save.mutate(undefined, { onSuccess: () => leave(t('memberSaved')) }); };
  const crumbs = [{ label: t('navOverview'), route: to.list('overview') }, { label: t('navStaff'), route: to.list('staff') }, { label: member.user.full_name }];

  return (
    <FormPage title={t('editMember')} sub={member.user.email ?? undefined} crumbs={crumbs} back={to.list('staff')} onSubmit={submit}
      saving={save.isPending} canSave={canSave} error={save.error}>
      <Card>
        <h2><bdi>{member.user.full_name}</bdi></h2>
        <div className="grid-2 mt">
          <Field label={t('staffRole')}>
            {(a) => <Choice id={a.id} value={form.roleId} onChange={set('roleId')} options={roleOptions(roles, has, member.role.id).map((r) => ({ value: r.id, label: roleLabel(r.key, r.name_ar) }))} />}
          </Field>
          <Field label={t('jobTitleLabel')} optional={t('optional')}>
            {(a) => <Input id={a.id} value={form.jobTitle} onChange={(e) => set('jobTitle')(e.target.value)} maxLength={80} />}
          </Field>
        </div>
        <div className="switch-row mt">
          <Switch checked={form.active} onChange={(on) => (on ? set('active')(true) : setConfirmOff(true))} label={t('memberActiveSwitch')} />
        </div>
      </Card>
      <BranchAccess branches={branches} allBranches={form.allBranches} branchIds={form.branchIds}
        onAll={set('allBranches')} onToggle={toggleBranch} missing={false} />
      <ConfirmDialog open={confirmOff} title={t('disableMemberTitle')} confirmLabel={t('disable')} danger
        onConfirm={() => { set('active')(false); setConfirmOff(false); }} onCancel={() => setConfirmOff(false)}>
        {t('disableMemberText')}
      </ConfirmDialog>
    </FormPage>
  );
}
