import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api, setSession, type ApiError, type Session } from '../api';
import { roleLabel, t } from '../i18n';
import type { InvitationPreview } from '../types';
import { Alert, Button, ErrorText, Field, Input, LinkButton, PasswordInput, Skeleton } from '../ui/components';
import { UsersIcon } from '../ui/icons';
import { passwordChecks } from '../util';

/**
 * `#/invite/<token>`: the link in a staff invitation email (SRS ACCESS-001). A new person creates their account (the
 * link proves the email); someone who already has one confirms its password. Joining signs them in to the clinic.
 */
export function AcceptInvite({ token, done }: { token: string; done: () => void }) {
  const preview = useQuery<InvitationPreview, ApiError>({
    queryKey: ['invitation', token], queryFn: () => api<InvitationPreview>(`/public/invitations/${token}`), retry: false,
  });
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const accept = useMutation({
    mutationFn: () => api<Session>(`/public/invitations/${token}/accept`, {
      method: 'POST', body: JSON.stringify(preview.data?.accountExists ? { password } : { fullName: fullName.trim(), password }),
    }),
    onSuccess: (s) => { done(); setSession(s); },
  });

  if (preview.isLoading) return <Skeleton h={120} count={2} />;
  if (preview.isError) {
    return (
      <>
        <header className="form-head"><div className="form-icon"><UsersIcon size={22} /></div><h2>{t('acceptTitle')}</h2></header>
        {preview.error.code === 'invitation_invalid' ? <Alert tone="info">{t('acceptInvalidText')}</Alert> : <ErrorText error={preview.error} />}
        <p className="form-foot center"><LinkButton onClick={done}>{t('backToLogin')}</LinkButton></p>
      </>
    );
  }
  const p = preview.data!;
  const clinic = arName(p.clinic.nameAr, p.clinic.nameEn, p.clinic.slug);
  const pwc = passwordChecks(password);
  const ok = p.accountExists ? password.length > 0 : fullName.trim().length >= 2 && pwc.length && pwc.letter && pwc.digit;
  const submit = (e: FormEvent) => { e.preventDefault(); if (ok) accept.mutate(); };

  return (
    <>
      <header className="form-head">
        <div className="form-icon"><UsersIcon size={22} /></div>
        <h2>{t('acceptTitle')}</h2>
        <p>{t('acceptIntro').replace('{clinic}', clinic).replace('{role}', roleLabel(p.role.key))}</p>
      </header>
      <form onSubmit={submit} className="stack">
        <p className="muted">{t(p.accountExists ? 'acceptExisting' : 'acceptNew')}</p>
        <Field label={t('email')}>{(a) => <Input id={a.id} value={p.email} dir="ltr" readOnly />}</Field>
        {!p.accountExists && (
          <Field label={t('fullName')}>{(a) => <Input id={a.id} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required autoFocus />}</Field>
        )}
        <Field label={t('password')} hint={p.accountExists ? undefined : t('pwLen')}>
          {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={p.accountExists ? 'current-password' : 'new-password'} required autoFocus={p.accountExists} showLabel={t('showPw')} hideLabel={t('hidePw')} />}
        </Field>
        <ErrorText error={accept.error} />
        <Button type="submit" block loading={accept.isPending} disabled={!ok}>{t('acceptJoin')}</Button>
      </form>
    </>
  );
}
