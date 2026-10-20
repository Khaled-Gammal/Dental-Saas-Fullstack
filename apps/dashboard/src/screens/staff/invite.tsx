import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api } from '../../api';
import { Choice } from '../../components/choice';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { roleLabel, t } from '../../i18n';
import { keys, useBranches, useDoctors, useMembers, useRoles } from '../../queries';
import { to } from '../../router';
import { EMPTY_INVITE, inviteProblem, toInviteBody, type InviteForm } from '../../staff-model';
import { roleOptions } from '../../roles-model';
import type { Branch, StaffInvitation, StaffRole } from '../../types';
import { Badge, Card, Field, Input, Switch } from '../../ui/components';
import { FormPage, ResourceState } from '../../ui/page';

/** `#/staff/new`: invite someone by email with a role and branch access (SRS ACCESS-001). */
export function StaffInvite({ clinicId, has }: { clinicId: string; has: (p: string) => boolean }) {
  const roles = useRoles(clinicId);
  const branches = useBranches(clinicId);
  const doctors = useDoctors(clinicId);
  const members = useMembers(clinicId);
  if (!roles.data || !branches.data || !doctors.data || !members.data) {
    const q = [roles, branches, doctors, members].find((x) => x.isError) ?? roles;
    return <ResourceState isLoading={!q.isError} isError={q.isError} error={q.error} notFound={false} refetch={() => void q.refetch()} back={to.list('staff')} backLabel={t('navStaff')} />;
  }
  // a doctor record can get a login only once
  const linkable = doctors.data.filter((d) => d.is_active && !members.data!.some((m) => m.doctor?.id === d.id));
  return <InviteBody clinicId={clinicId} roles={roleOptions(roles.data, has)} branches={branches.data.filter((b) => b.is_active)}
    doctors={linkable.map((d) => ({ value: d.id, label: arName(d.name_ar, d.name_en, '—') }))} />;
}

function InviteBody({ clinicId, roles, branches, doctors }: {
  clinicId: string; roles: StaffRole[]; branches: Branch[]; doctors: { value: string; label: string }[];
}) {
  const [form, setForm] = useState<InviteForm>(EMPTY_INVITE);
  const [tried, setTried] = useState(false);
  const qc = useQueryClient();
  const leave = useLeave(to.list('staff'));
  const problem = inviteProblem(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_INVITE);
  useUnsavedChanges(dirty, t('leaveUnsaved'));
  const set = <K extends keyof InviteForm>(k: K) => (v: InviteForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleBranch = (id: string, on: boolean) => set('branchIds')(on ? [...form.branchIds, id] : form.branchIds.filter((x) => x !== id));

  const send = useMutation({
    mutationFn: () => api<StaffInvitation>('/staff/invitations', { method: 'POST', body: JSON.stringify(toInviteBody(form)) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.staff(clinicId) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!problem) send.mutate(undefined, { onSuccess: () => leave(t('inviteSent')) });
  };
  const show = (p: typeof problem) => tried && problem === p;
  const crumbs = [{ label: t('navOverview'), route: to.list('overview') }, { label: t('navStaff'), route: to.list('staff') }, { label: t('inviteTitle') }];

  return (
    <FormPage title={t('inviteTitle')} sub={t('inviteSub')} crumbs={crumbs} back={to.list('staff')} onSubmit={submit}
      saving={send.isPending} canSave={!send.isPending} error={send.error}>
      <Card>
        <div className="grid-2">
          <Field label={t('email')} error={show('email') ? t('needEmail') : undefined}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} type="email" dir="ltr" autoComplete="off" value={form.email} onChange={(e) => set('email')(e.target.value)} invalid={show('email')} autoFocus />}
          </Field>
          <Field label={t('staffRole')} error={show('role') ? t('needRole') : undefined}>
            {(a) => <Choice id={a.id} value={form.roleId} onChange={set('roleId')} placeholder={t('needRole')} invalid={show('role')}
              options={roles.map((r) => ({ value: r.id, label: roleLabel(r.key, r.name_ar) }))} />}
          </Field>
          <Field label={t('jobTitleLabel')} optional={t('optional')}>
            {(a) => <Input id={a.id} value={form.jobTitle} onChange={(e) => set('jobTitle')(e.target.value)} maxLength={80} />}
          </Field>
          <Field label={t('linkDoctor')} optional={t('optional')} hint={t('linkDoctorHint')}>
            {(a) => <Choice id={a.id} value={form.doctorId} onChange={set('doctorId')} noneLabel={t('noDoctorLink')} options={doctors} />}
          </Field>
        </div>
      </Card>
      <BranchAccess branches={branches} allBranches={form.allBranches} branchIds={form.branchIds}
        onAll={set('allBranches')} onToggle={toggleBranch} missing={show('branches')} />
    </FormPage>
  );
}

/** "Works at every branch" or a list of branches (shared by the invite and the member forms). */
export function BranchAccess({ branches, allBranches, branchIds, onAll, onToggle, missing }: {
  branches: Branch[]; allBranches: boolean; branchIds: string[]; onAll: (v: boolean) => void; onToggle: (id: string, on: boolean) => void; missing: boolean;
}) {
  return (
    <Card>
      <fieldset className="check-group">
        <legend>{t('accessBranches')}</legend>
        <div className="switch-row mt"><Switch checked={allBranches} onChange={onAll} label={t('allBranchesSwitch')} /></div>
        {!allBranches && (
          <>
            <p className="muted small">{t('accessBranchesHint')}</p>
            <div className="branch-checks">
              {branches.map((b) => (
                <label key={b.id} className="check">
                  <input type="checkbox" checked={branchIds.includes(b.id)} onChange={(e) => onToggle(b.id, e.target.checked)} />
                  <bdi>{arName(b.name_ar, b.name_en, b.slug)}</bdi>{b.is_main && <Badge tone="primary">{t('main')}</Badge>}
                </label>
              ))}
            </div>
            {(missing || branchIds.length === 0) && <p className="field-error">{t('needBranch')}</p>}
          </>
        )}
      </fieldset>
    </Card>
  );
}
