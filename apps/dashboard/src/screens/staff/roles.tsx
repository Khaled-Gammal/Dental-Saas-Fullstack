import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { navigate, useFlash, useLeave, useUnsavedChanges } from '../../hooks';
import { roleLabel, t, type Key } from '../../i18n';
import { keys, usePermissionCatalogue, useRoles } from '../../queries';
import { mixesClinicalAndMoney, togglePermission } from '../../roles-model';
import { to } from '../../router';
import type { PermissionGroup, StaffRole } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { RowMenu } from '../../ui/row-menu';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { CopyIcon, EditIcon, PlusIcon, ShieldIcon } from '../../ui/icons';
import { FormPage, ResourceState } from '../../ui/page';
import { Checkbox } from '../../components/ui/checkbox';

const permLabel = (p: string) => t(`perm_${p}` as Key);

/**
 * `#/roles` (H4): the clinic's roles (owner 2026-10-20). Sign-up creates only the owner role, which holds every
 * permission and is fixed; the owner — or a member given staff:manage — creates, changes and deletes every other role
 * from the permission catalogue. A role nobody ever held is deleted; one that was referred to is archived.
 */
export function RolesList({ clinicId }: { clinicId: string }) {
  const roles = useRoles(clinicId);
  const flash = useFlash();
  const [notice, setNotice] = useState<string | null>(null);
  const active = roles.data?.filter((r) => !r.archived_at) ?? [];
  const archived = roles.data?.filter((r) => r.archived_at) ?? [];
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<StaffRole | null>(null);
  // one delete for both tables (U2): a role nobody held is deleted, one referred to is archived
  const remove = useMutation({
    mutationFn: (id: string) => api<{ archived: boolean }>(`/staff/roles/${id}`, { method: 'DELETE' }),
    onSuccess: (res) => { setNotice(t(res.archived ? 'roleArchivedNotice' : 'roleDeleted')); void qc.invalidateQueries({ queryKey: keys.staff(clinicId) }); },
  });
  const menu = (r: StaffRole) => (
    <RowMenu label={roleLabel(r.key, r.name_ar)} actions={[
      r.can.edit
        ? { label: t('edit'), icon: <EditIcon size={16} />, route: to.edit('roles', r.id) }
        : { label: t('viewRole'), icon: <ShieldIcon size={16} />, route: to.view('roles', r.id) },
      { label: t('copyAsNew'), icon: <CopyIcon size={16} />, route: to.create('roles', { from: r.id }), hidden: !!r.archived_at || r.key === 'owner' },
      { label: t('deleteRole'), destructive: true, onSelect: () => setRemoving(r), hidden: !r.can.remove },
    ]} />
  );
  const table = (label: string, rows: StaffRole[] | undefined) => (
    <DataTable label={label} rows={rows} columns={ROLE_COLUMNS} rowKey={(r) => r.id} isLoading={roles.isLoading} isFetching={roles.isFetching || remove.isPending}
      error={roles.isError ? roles.error : undefined} onRetry={() => void roles.refetch()} actions={menu}
      onRowClick={(r) => navigate(r.can.edit ? to.edit('roles', r.id) : to.view('roles', r.id))}
      empty={{ icon: <ShieldIcon size={28} />, title: t('noCustomRoles'), text: t('noCustomRolesText') }} />
  );
  return (
    <>
      <PageHeader title={t('navRoles')} sub={t('rolesSub')} action={<Button onClick={() => navigate(to.create('roles'))}><PlusIcon size={18} />{t('newRole')}</Button>} />
      {(flash || notice) && <Alert tone="success">{notice ?? flash}</Alert>}
      <ErrorText error={remove.error} />
      {table(t('navRoles'), roles.data ? active : undefined)}
      {roles.data && !active.some((r) => !r.is_system) && (
        <Card><EmptyState icon={<ShieldIcon size={28} />} title={t('noCustomRoles')} text={t('noCustomRolesText')} /></Card>
      )}
      {archived.length > 0 && (
        <>
          <h2 className="section-title mt">{t('archivedRoles')}</h2>
          {table(t('archivedRoles'), archived)}
        </>
      )}
      <ConfirmDialog open={!!removing} title={t('deleteRole')} confirmLabel={t('deleteRole')} danger
        onConfirm={() => { if (removing) remove.mutate(removing.id); setRemoving(null); }} onCancel={() => setRemoving(null)}>
        {t('deleteRoleText')}
      </ConfirmDialog>
    </>
  );
}

/** The roles table: the role, what it may do and who holds it; the badges say what is special about it. */
const ROLE_COLUMNS: Column<StaffRole>[] = [
  {
    id: 'role', header: t('staffColRole'), sortValue: (r) => roleLabel(r.key, r.name_ar),
    cell: (r) => (
      <span className="patient-main">
        <span className="patient-avatar" aria-hidden><ShieldIcon size={18} /></span>
        <span className="patient-text"><strong><bdi>{roleLabel(r.key, r.name_ar)}</bdi></strong>
          <span className="muted small">{r.permissions.includes('*') ? t('allPermissions') : t('rolePermsCount').replace('{n}', String(r.permissions.length))}</span></span>
      </span>
    ),
  },
  {
    id: 'members', header: t('members'), sortValue: (r) => r.members,
    cell: (r) => <>{t('roleMembers').replace('{n}', String(r.members))}{r.invitations > 0 && <span className="muted small block">{t('roleInvites').replace('{n}', String(r.invitations))}</span>}</>,
  },
  {
    id: 'badges', header: t('status'), hideOnMobile: true,
    cell: (r) => (
      <span className="patient-badges">
        {r.is_system && <Badge tone="primary">{t('roleFixed')}</Badge>}
        {r.archived_at && <Badge tone="warning">{t('roleArchived')}</Badge>}
        {r.mixes_clinical_and_money && <Badge tone="warning">{t('roleMixBadge')}</Badge>}
        {!r.is_system && !r.archived_at && !r.mixes_clinical_and_money && <span className="muted">—</span>}
      </span>
    ),
  },
];

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
    <FormPage title={title} sub={readOnly ? (role?.is_system ? undefined : t('roleReadOnlyNote')) : t('roleFormSub')} crumbs={crumbs} back={to.list('roles')}
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
                      <Checkbox checked={on} disabled={locked}
                        onCheckedChange={(v) => setPerms(togglePermission(catalogue, perms, p.key, v === true))} />
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
