import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { navigate, useFlash, useLeave, useUnsavedChanges } from '../../hooks';
import { roleLabel, t, type Key } from '../../i18n';
import { keys, usePermissionCatalogue, useRoles } from '../../queries';
import { mixesClinicalAndMoney, togglePermission } from '../../roles-model';
import { to } from '../../router';
import type { PermissionGroup, StaffRole } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, LinkButton, PageHeader, Skeleton } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { EditIcon, PlusIcon, ShieldIcon } from '../../ui/icons';
import { FormPage, ResourceState, RouteLink } from '../../ui/page';

const permLabel = (p: string) => t(`perm_${p}` as Key);

/**
 * `#/roles` (H4): the clinic's roles. The built-in ones (owner, doctor, reception, assistant, accountant) keep the
 * permissions the SRS sets and are viewed or copied; the owner — or a member given staff:manage — creates roles of
 * their own from the permission catalogue. A role nobody ever held is deleted; one that was held is archived.
 */
export function RolesList({ clinicId }: { clinicId: string }) {
  const roles = useRoles(clinicId);
  const flash = useFlash();
  const [notice, setNotice] = useState<string | null>(null);
  const active = roles.data?.filter((r) => !r.archived_at) ?? [];
  const archived = roles.data?.filter((r) => r.archived_at) ?? [];
  return (
    <>
      <PageHeader title={t('navRoles')} sub={t('rolesSub')} action={<Button onClick={() => navigate(to.create('roles'))}><PlusIcon size={18} />{t('newRole')}</Button>} />
      {(flash || notice) && <Alert tone="success">{notice ?? flash}</Alert>}
      {roles.isError ? <ErrorText error={roles.error} onRetry={() => void roles.refetch()} />
        : roles.isLoading ? <Skeleton h={72} count={4} />
        : (
          <ul className="patient-rows">
            {active.map((r) => <RoleRow key={r.id} r={r} clinicId={clinicId} onDone={setNotice} />)}
          </ul>
        )}
      {roles.data && !active.some((r) => !r.is_system) && (
        <Card><EmptyState icon={<ShieldIcon size={28} />} title={t('noCustomRoles')} text={t('noCustomRolesText')} /></Card>
      )}
      {archived.length > 0 && (
        <>
          <h2 className="section-title mt">{t('archivedRoles')}</h2>
          <ul className="patient-rows">{archived.map((r) => <RoleRow key={r.id} r={r} clinicId={clinicId} onDone={setNotice} />)}</ul>
        </>
      )}
    </>
  );
}

function RoleRow({ r, clinicId, onDone }: { r: StaffRole; clinicId: string; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => api<{ archived: boolean }>(`/staff/roles/${r.id}`, { method: 'DELETE' }),
    onSuccess: (res) => { onDone(t(res.archived ? 'roleArchivedNotice' : 'roleDeleted')); void qc.invalidateQueries({ queryKey: keys.staff(clinicId) }); },
  });
  const count = r.permissions.includes('*') ? t('allPermissions') : t('rolePermsCount').replace('{n}', String(r.permissions.length));
  return (
    <Card as="li" className="patient-row">
      <span className="patient-main">
        <span className="patient-avatar" aria-hidden><ShieldIcon size={18} /></span>
        <span className="patient-text">
          <strong><bdi>{roleLabel(r.key, r.name_ar)}</bdi></strong>
          <span className="muted small">
            {count} · {t('roleMembers').replace('{n}', String(r.members))}
            {r.invitations > 0 && <> · {t('roleInvites').replace('{n}', String(r.invitations))}</>}
          </span>
        </span>
      </span>
      <span className="patient-badges">
        <Badge tone={r.is_system ? 'primary' : 'neutral'}>{t(r.is_system ? 'roleBuiltIn' : 'roleCustom')}</Badge>
        {r.archived_at && <Badge tone="warning">{t('roleArchived')}</Badge>}
        {r.mixes_clinical_and_money && <Badge tone="warning">{t('roleMixBadge')}</Badge>}
      </span>
      <span className="row-end">
        {r.can.edit
          ? <RouteLink route={to.edit('roles', r.id)} className="btn btn-secondary btn-sm"><EditIcon size={16} />{t('edit')}</RouteLink>
          : <RouteLink route={to.view('roles', r.id)} className="btn btn-secondary btn-sm">{t('viewRole')}</RouteLink>}
        {!r.archived_at && r.key !== 'owner' && <RouteLink route={to.create('roles', { from: r.id })}>{t('copyAsNew')}</RouteLink>}
        {r.can.remove && <LinkButton onClick={() => setConfirm(true)}>{t('deleteRole')}</LinkButton>}
      </span>
      <ErrorText error={remove.error} />
      <ConfirmDialog open={confirm} title={t('deleteRole')} confirmLabel={t('deleteRole')} danger
        onConfirm={() => { setConfirm(false); remove.mutate(); }} onCancel={() => setConfirm(false)}>
        {t('deleteRoleText')}
      </ConfirmDialog>
    </Card>
  );
}

/** `#/roles/new` (optionally `?from=<role>` to start from a copy), `#/roles/<id>/edit`, `#/roles/<id>/view`. */
export function RoleForm({ clinicId, has, id, copyFrom, readOnly = false }: {
  clinicId: string; has: (p: string) => boolean; id?: string; copyFrom?: string; readOnly?: boolean;
}) {
  const roles = useRoles(clinicId);
  const catalogue = usePermissionCatalogue(clinicId);
  const role = id ? roles.data?.find((r) => r.id === id) : undefined;
  if (!roles.data || !catalogue.data || (id && !role)) {
    const q = roles.isError ? roles : catalogue;
    return <ResourceState isLoading={!q.isError && !roles.data} isError={q.isError} error={q.error} notFound={!!roles.data && !!id && !role}
      refetch={() => void q.refetch()} back={to.list('roles')} backLabel={t('navRoles')} />;
  }
  const source = role ?? roles.data.find((r) => r.id === copyFrom);
  return <RoleBody key={role?.id ?? copyFrom ?? 'new'} clinicId={clinicId} has={has} role={role} source={source} catalogue={catalogue.data}
    readOnly={readOnly || (!!role && !role.can.edit)} />;
}

function RoleBody({ clinicId, has, role, source, catalogue, readOnly }: {
  clinicId: string; has: (p: string) => boolean; role?: StaffRole; source?: StaffRole; catalogue: PermissionGroup[]; readOnly: boolean;
}) {
  const grantable = catalogue.flatMap((g) => g.permissions.map((p) => p.key));
  // a copy starts from the source's permissions the caller may give ('*' = every permission of the catalogue)
  const start = (() => {
    if (role) return [...role.permissions];
    if (!source) return [];
    const from = source.permissions.includes('*') ? grantable : source.permissions.filter((p) => grantable.includes(p));
    return from.filter(has);
  })();
  const [name, setName] = useState(role ? role.name_ar : source ? `${roleLabel(source.key, source.name_ar)} — ${t('copyWord')}` : '');
  const [perms, setPerms] = useState<string[]>(start);
  const [tried, setTried] = useState(false);
  const qc = useQueryClient();
  const leave = useLeave(to.list('roles'));
  const dirty = !readOnly && (name !== (role?.name_ar ?? '') || perms.join() !== start.join() || !role);
  useUnsavedChanges(dirty && (!!name.trim() || perms.length > 0), t('leaveUnsaved'));
  const save = useMutation({
    mutationFn: () => api<StaffRole>(role ? `/staff/roles/${role.id}` : '/staff/roles', {
      method: role ? 'PATCH' : 'POST', body: JSON.stringify({ nameAr: name.trim(), permissions: perms }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.staff(clinicId) }),
  });
  const nameOk = name.trim().length >= 2;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!readOnly && nameOk) save.mutate(undefined, { onSuccess: () => leave(t(role ? 'roleSaved' : 'roleCreated')) });
  };
  const title = readOnly ? roleLabel(role!.key, role!.name_ar) : t(role ? 'editRole' : 'newRole');
  const crumbs = [{ label: t('navOverview'), route: to.list('overview') }, { label: t('navRoles'), route: to.list('roles') }, { label: title }];
  const everything = role?.permissions.includes('*');

  return (
    <FormPage title={title} sub={t(readOnly ? (role?.is_system ? 'builtInRoleNote' : 'roleReadOnlyNote') : 'roleFormSub')} crumbs={crumbs} back={to.list('roles')}
      onSubmit={submit} saving={save.isPending} canSave={!readOnly && nameOk && !save.isPending} error={save.error}
      notice={!readOnly && mixesClinicalAndMoney(perms) ? <Alert tone="info">{t('roleMixWarning')}</Alert> : undefined}>
      {!readOnly && (
        <Card>
          <Field label={t('roleName')} error={tried && !nameOk ? t('needRoleName') : undefined}>
            {(a) => <Input id={a.id} describedBy={a.describedBy} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} invalid={tried && !nameOk} autoFocus />}
          </Field>
          {!has('*') && <p className="muted small mt-sm">{t('permNotHeldHint')}</p>}
        </Card>
      )}
      {everything ? <Card><p>{t('ownerRoleNote')}</p></Card> : catalogue.map((g) => (
        <Card key={g.key}>
          <fieldset className="perm-group">
            <legend><h2>{t(`permGroup_${g.key}` as Key)}</h2></legend>
            <ul className="perm-list">
              {g.permissions.map((p) => {
                const on = perms.includes(p.key);
                // a member who is not the owner may take away any permission but add only those they hold
                const locked = readOnly || (!on && !has(p.key));
                return (
                  <li key={p.key}>
                    <label className={`check${locked && !on ? ' muted' : ''}`}>
                      <input type="checkbox" checked={on} disabled={locked}
                        onChange={(e) => setPerms(togglePermission(catalogue, perms, p.key, e.target.checked))} />
                      <span>{permLabel(p.key)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </Card>
      ))}
      {readOnly && role && !role.is_system && role.can.edit === false && !role.archived_at && <Alert tone="info">{t('ownRoleNote')}</Alert>}
    </FormPage>
  );
}
