import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pickName } from '@dental/ui/text';
import { api } from '../../api';
import { Choice } from '../../components/choice';
import { useLeave, useUnsavedChanges } from '../../hooks';
import { roleLabel, t, type Lang } from '../../i18n';
import { keys, useBranches, useDoctors, useMembers, useRoles } from '../../queries';
import { to } from '../../router';
import { EMPTY_INVITE, inviteProblem, toInviteBody, type InviteForm } from '../../staff-model';
import type { Branch, StaffInvitation } from '../../types';
import { Badge, Card, Field, Input, Switch } from '../../ui/components';
import { FormPage, ResourceState } from '../../ui/page';

/** `#/staff/new`: invite someone by email with a role and branch access (SRS ACCESS-001). */
export function StaffInvite({ lang, clinicId }: { lang: Lang; clinicId: string }) {
  const roles = useRoles(clinicId);
  const branches = useBranches(clinicId);
  const doctors = useDoctors(clinicId);
  const members = useMembers(clinicId);
  if (!roles.data || !branches.data || !doctors.data || !members.data) {
    const q = [roles, branches, doctors, members].find((x) => x.isError) ?? roles;
    return <ResourceState isLoading={!q.isError} isError={q.isError} error={q.error} notFound={false} refetch={() => void q.refetch()} back={to.list('staff')} backLabel={t('navStaff', lang)} />;
  }
  // a doctor record can get a login only once
  const linkable = doctors.data.filter((d) => d.is_active && !members.data!.some((m) => m.doctor?.id === d.id));
  return <InviteBody lang={lang} clinicId={clinicId} roles={roles.data} branches={branches.data.filter((b) => b.is_active)}
    doctors={linkable.map((d) => ({ value: d.id, label: pickName(lang, d.name_ar, d.name_en, '—') }))} />;
}

function InviteBody({ lang, clinicId, roles, branches, doctors }: {
  lang: Lang; clinicId: string; roles: { id: string; key: string }[]; branches: Branch[]; doctors: { value: string; label: string }[];
}) {
  const [form, setForm] = useState<InviteForm>(EMPTY_INVITE);
  const [tried, setTried] = useState(false);
  const qc = useQueryClient();
  const leave = useLeave(to.list('staff'));
  const problem = inviteProblem(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_INVITE);
  useUnsavedChanges(dirty, t('leaveUnsaved', lang));
  const set = <K extends keyof InviteForm>(k: K) => (v: InviteForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleBranch = (id: string, on: boolean) => set('branchIds')(on ? [...form.branchIds, id] : form.branchIds.filter((x) => x !== id));

  const send = useMutation({
    mutationFn: () => api<StaffInvitation>('/staff/invitations', { method: 'POST', body: JSON.stringify(toInviteBody(form)) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.staff(clinicId) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!problem) send.mutate(undefined, { onSuccess: () => leave(t('inviteSent', lang)) });
  };
  const show = (p: typeof problem) => tried && problem === p;
  const crumbs = [{ label: t('navOverview', lang), route: to.list('overview') }, { label: t('navStaff', lang), route: to.list('staff') }, { label: t('inviteTitle', lang) }];

  return (
    <FormPage title={t('inviteTitle', lang)} sub={t('inviteSub', lang)} crumbs={crumbs} back={to.list('staff')} onSubmit={submit}
      saving={send.isPending} canSave={!send.isPending} error={send.error}>
      <Card>
        <div className="grid-2">
          <Field label={t('email', lang)} error={show('email') ? t('needEmail', lang) : undefined}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} type="email" dir="ltr" autoComplete="off" value={form.email} onChange={(e) => set('email')(e.target.value)} invalid={show('email')} autoFocus />}
          </Field>
          <Field label={t('staffRole', lang)} error={show('role') ? t('needRole', lang) : undefined}>
            {(a) => <Choice id={a.id} lang={lang} value={form.roleId} onChange={set('roleId')} placeholder={t('needRole', lang)} invalid={show('role')}
              options={roles.map((r) => ({ value: r.id, label: roleLabel(r.key, lang) }))} />}
          </Field>
          <Field label={t('jobTitleLabel', lang)} optional={t('optional', lang)}>
            {(a) => <Input id={a.id} value={form.jobTitle} onChange={(e) => set('jobTitle')(e.target.value)} maxLength={80} />}
          </Field>
          <Field label={t('linkDoctor', lang)} optional={t('optional', lang)} hint={t('linkDoctorHint', lang)}>
            {(a) => <Choice id={a.id} lang={lang} value={form.doctorId} onChange={set('doctorId')} noneLabel={t('noDoctorLink', lang)} options={doctors} />}
          </Field>
        </div>
      </Card>
      <BranchAccess lang={lang} branches={branches} allBranches={form.allBranches} branchIds={form.branchIds}
        onAll={set('allBranches')} onToggle={toggleBranch} missing={show('branches')} />
    </FormPage>
  );
}

/** "Works at every branch" or a list of branches (shared by the invite and the member forms). */
export function BranchAccess({ lang, branches, allBranches, branchIds, onAll, onToggle, missing }: {
  lang: Lang; branches: Branch[]; allBranches: boolean; branchIds: string[]; onAll: (v: boolean) => void; onToggle: (id: string, on: boolean) => void; missing: boolean;
}) {
  return (
    <Card>
      <fieldset className="check-group">
        <legend>{t('accessBranches', lang)}</legend>
        <div className="switch-row mt"><Switch checked={allBranches} onChange={onAll} label={t('allBranchesSwitch', lang)} /></div>
        {!allBranches && (
          <>
            <p className="muted small">{t('accessBranchesHint', lang)}</p>
            <div className="branch-checks">
              {branches.map((b) => (
                <label key={b.id} className="check">
                  <input type="checkbox" checked={branchIds.includes(b.id)} onChange={(e) => onToggle(b.id, e.target.checked)} />
                  <bdi>{pickName(lang, b.name_ar, b.name_en, b.slug)}</bdi>{b.is_main && <Badge tone="primary">{t('main', lang)}</Badge>}
                </label>
              ))}
            </div>
            {(missing || branchIds.length === 0) && <p className="field-error">{t('needBranch', lang)}</p>}
          </>
        )}
      </fieldset>
    </Card>
  );
}
