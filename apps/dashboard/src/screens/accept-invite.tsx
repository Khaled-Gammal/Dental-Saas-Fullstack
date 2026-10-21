import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { arName } from '@dental/ui/text';
import { api, setSession, type ApiError, type Session } from '../api';
import { roleLabel } from '../labels';
import type { InvitationPreview } from '../types';
import { Alert, Button, ErrorText, Field, Input, LinkButton, PasswordInput, Skeleton } from '../ui/components';
import { UsersIcon } from '../ui/icons';
import { LegalConsent } from '../components/legal';
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
  const [agreed, setAgreed] = useState(false);
  const legalIds = (preview.data?.legal ?? []).map((d) => d.id);
  const accept = useMutation({
    mutationFn: () => api<Session>(`/public/invitations/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ ...(preview.data?.accountExists ? { password } : { fullName: fullName.trim(), password }), acceptedDocuments: agreed ? legalIds : [] }),
    }),
    onSuccess: (s) => { done(); setSession(s); },
  });

  if (preview.isLoading) return <Skeleton h={120} count={2} />;
  if (preview.isError) {
    return (
      <>
        <header className="form-head"><div className="form-icon"><UsersIcon size={22} /></div><h2>دعوة للانضمام</h2></header>
        {preview.error.code === 'invitation_invalid' ? <Alert tone="info">هذا الرابط لم يعد صالحًا (استُخدم أو أُلغي أو انتهت مدته). اطلب من العيادة دعوة جديدة.</Alert> : <ErrorText error={preview.error} />}
        <p className="form-foot center"><LinkButton onClick={done}>العودة لتسجيل الدخول</LinkButton></p>
      </>
    );
  }
  const p = preview.data!;
  const clinic = arName(p.clinic.nameAr, p.clinic.nameEn, p.clinic.slug);
  const pwc = passwordChecks(password);
  const ok = (p.accountExists ? password.length > 0 : fullName.trim().length >= 2 && pwc.length && pwc.letter && pwc.digit) && (!p.legal?.length || agreed);
  const submit = (e: FormEvent) => { e.preventDefault(); if (ok) accept.mutate(); };

  return (
    <>
      <header className="form-head">
        <div className="form-icon"><UsersIcon size={22} /></div>
        <h2>دعوة للانضمام</h2>
        <p>{'دعتك {clinic} للانضمام إلى فريقها بدور {role}.'.replace('{clinic}', clinic).replace('{role}', roleLabel(p.role.key, p.role.nameAr))}</p>
      </header>
      <form onSubmit={submit} className="stack">
        <p className="muted">{p.accountExists ? 'لديك حساب بهذا البريد. أدخل كلمة المرور للانضمام.' : 'أنشئ حسابك لقبول الدعوة.'}</p>
        <Field label="البريد الإلكتروني">{(a) => <Input id={a.id} value={p.email} dir="ltr" readOnly />}</Field>
        {!p.accountExists && (
          <Field label="اسمك">{(a) => <Input id={a.id} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required autoFocus />}</Field>
        )}
        <Field label="كلمة المرور" hint={p.accountExists ? undefined : '8 أحرف على الأقل'}>
          {(a) => <PasswordInput id={a.id} describedBy={a.describedBy} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={p.accountExists ? 'current-password' : 'new-password'} required autoFocus={p.accountExists} showLabel="إظهار كلمة المرور" hideLabel="إخفاء كلمة المرور" />}
        </Field>
        <LegalConsent docs={p.legal ?? []} checked={agreed} onChange={setAgreed} />
        <ErrorText error={accept.error} />
        <Button type="submit" block loading={accept.isPending} disabled={!ok}>قبول الدعوة والدخول</Button>
      </form>
    </>
  );
}
