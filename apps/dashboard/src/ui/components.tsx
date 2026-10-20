import { useId, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { ApiError } from '../api';
import { errorText } from '../labels';
import { fieldIssueText } from '../validation-text';
import { AlertIcon, CheckIcon, EyeIcon, EyeOffIcon, ToothIcon } from './icons';
export { initials } from '@dental/ui/text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Defaults to type="button" so a Button inside a form never submits it by accident; pass type="submit" explicitly. */
export function Button({ variant = 'primary', loading, block, children, className = '', type = 'button', ...rest }:
  ComponentProps<'button'> & { variant?: Variant; loading?: boolean; block?: boolean }) {
  return (
    <button {...rest} type={type} className={`btn btn-${variant}${block ? ' btn-block' : ''} ${className}`}
      disabled={rest.disabled || loading} aria-busy={loading || undefined}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function LinkButton({ children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={`link-btn ${className}`}>{children}</button>;
}

export const Spinner = () => <span className="spinner" aria-hidden />;

export function Logo({ name, light }: { name: string; light?: boolean }) {
  return (
    <span className={`logo${light ? ' logo-light' : ''}`}>
      <span className="logo-mark"><ToothIcon size={20} /></span>
      <span className="logo-text">{name}</span>
    </span>
  );
}

/** Label + control + hint/error. The control gets ids wired for aria-describedby. */
export function Field({ label, hint, error, children, optional }: {
  label: string; hint?: ReactNode; error?: string; optional?: string;
  children: (a: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{optional && <span className="optional"> · {optional}</span>}</label>
      {children({ id, describedBy: [hintId, errId].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {hint && <div id={hintId} className="hint">{hint}</div>}
      {error && <div id={errId} className="field-error">{error}</div>}
    </div>
  );
}

export function Input({ invalid, describedBy, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; describedBy?: string }) {
  return <input {...rest} className={`input ${rest.className ?? ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} />;
}

export function TextArea({ invalid, describedBy, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; describedBy?: string }) {
  return <textarea rows={3} {...rest} className={`input textarea ${rest.className ?? ''}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} />;
}

/** An on/off switch that is a real checkbox underneath (keyboard and screen readers just work). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden><span className="switch-thumb" /></span>
      <span className="switch-label">{label}</span>
    </label>
  );
}

export function PasswordInput({ showLabel, hideLabel, ...rest }: InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean; describedBy?: string; showLabel: string; hideLabel: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap" dir="ltr">
      <Input {...rest} type={show ? 'text' : 'password'} />
      <button type="button" className="input-icon-btn" onClick={() => setShow(!show)} aria-label={show ? hideLabel : showLabel} aria-pressed={show}>
        {show ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
      </button>
    </div>
  );
}

/**
 * Six visible boxes backed by ONE real input, so paste, SMS autofill (one-time-code),
 * screen readers and the Arabic keyboard all behave like a normal text field.
 */
export function OtpInput({ value, onChange, id, describedBy, invalid, length = 6, label }: {
  value: string; onChange: (v: string) => void; id: string; describedBy?: string; invalid?: boolean; length?: number; label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  return (
    <div className={`otp${invalid ? ' otp-invalid' : ''}`} onClick={() => ref.current?.focus()} dir="ltr">
      {Array.from({ length }, (_, i) => (
        <span key={i} className={`otp-box${value[i] ? ' filled' : ''}${focused && i === Math.min(value.length, length - 1) ? ' active' : ''}`} aria-hidden>
          {value[i] ?? ''}
        </span>
      ))}
      <input ref={ref} id={id} className="otp-input" value={value} onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        inputMode="numeric" autoComplete="one-time-code" maxLength={length + 4} required pattern={`\\d{${length}}`}
        aria-label={label} aria-describedby={describedBy} aria-invalid={invalid || undefined} />
    </div>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {tone === 'success' ? <CheckIcon size={18} /> : <AlertIcon size={18} />}
      <div>{children}</div>
    </div>
  );
}

/** Shows an API error in Arabic: the code's text, else the status's; field problems by rule (L10N-003). */
export function ErrorText({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const e = error as Partial<ApiError>;
  const code = typeof e.code === 'string' ? e.code : 'error';
  return (
    <Alert>
      {errorText(code, typeof e.status === 'number' ? e.status : undefined)}
      {e.errors?.length ? <ul>{e.errors.map((x, i) => <li key={`${x.path}-${i}`}>{fieldIssueText(x)}</li>)}</ul> : null}
      {onRetry && <div><LinkButton onClick={onRetry} className="alert-action">إعادة المحاولة</LinkButton></div>}
    </Alert>
  );
}

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
/** A short label; `dot` marks a status (a coloured dot before the word, as in a table's status column). */
export function Badge({ tone = 'neutral', dot, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return <span className={`badge badge-${tone}${dot ? ' badge-dot' : ''}`}>{children}</span>;
}

export function Card({ children, className = '', as: Tag = 'section', id }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'li' | 'form'; id?: string }) {
  return <Tag className={`card ${className}`} id={id}>{children}</Tag>;
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Skeleton({ h = 72, count = 3 }: { h?: number; count?: number }) {
  return <>{Array.from({ length: count }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} aria-hidden />)}</>;
}

/**
 * A page's title, its one-line description, an optional count next to the title ("12 مريض") and the page's actions
 * (redesign R2: the same header on every page; breadcrumbs, where a page has them, sit just above it).
 */
export function PageHeader({ title, sub, count, action }: { title: ReactNode; sub?: ReactNode; count?: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}{count !== undefined && count !== null && <span className="page-count">{count}</span>}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
