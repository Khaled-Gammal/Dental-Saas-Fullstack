import { useEffect, useRef, type AnchorHTMLAttributes, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { t } from '../i18n';
import { navigate } from '../hooks';
import { href, type Route } from '../router';
import { Alert, Button, ErrorText, Skeleton } from './components';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export interface Crumb { label: string; route?: Route }

/** A real link to a route (middle-click / copy address work) that navigates in-app on a plain click. */
export function RouteLink({ route, className = 'link-btn', children, ...rest }: { route: Route; className?: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(route);
  };
  return <a {...rest} href={href(route)} className={className} onClick={onClick}>{children}</a>;
}

/** "Overview › Doctors › Edit" — every crumb but the last is a link (shadcn/ui Breadcrumb; the chevrons point left in RTL). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb aria-label={t('breadcrumbs')} className="-mb-2">
      <BreadcrumbList className="gap-1 text-sm text-muted-foreground sm:gap-1.5">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <BreadcrumbItem key={i}>
              {c.route && !last
                ? <BreadcrumbLink asChild><RouteLink route={c.route} className="hover:text-primary-600">{c.label}</RouteLink></BreadcrumbLink>
                : <BreadcrumbPage className={last ? 'font-semibold text-ink' : undefined}>{c.label}</BreadcrumbPage>}
              {!last && <BreadcrumbSeparator className="rtl:rotate-180" />}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The one layout for every create/edit screen: breadcrumbs, a focused heading, the form body,
 * and a sticky footer with Cancel + Save. The caller owns the state; this owns the chrome.
 */
export function FormPage({ title, sub, crumbs, back, onSubmit, saving, canSave, error, notice, children, extra }: {
  title: string; sub?: string; crumbs: Crumb[]; back: Route; onSubmit: (e: FormEvent) => void;
  saving: boolean; canSave: boolean; error?: unknown; notice?: ReactNode; children: ReactNode; extra?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // a new page: tell screen readers where we are, unless a field already took focus (autoFocus on create pages)
    const a = document.activeElement;
    if (!a || a === document.body || a.id === 'main') heading.current?.focus();
  }, []);
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <div className="page-head">
        <div className="page-head-text">
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {extra && <div className="page-actions">{extra}</div>}
      </div>
      <form onSubmit={onSubmit} className="form-page" noValidate>
        <div className="stack">{children}</div>
        {notice}
        <ErrorText error={error} />
        <div className="form-footer">
          <Button variant="ghost" onClick={() => navigate(back)}>{t('cancel')}</Button>
          <Button type="submit" loading={saving} disabled={!canSave}>{t('save')}</Button>
        </div>
      </form>
    </>
  );
}

/** Loading / error / missing states for a page that edits one resource. */
export function ResourceState({ isLoading, isError, error, notFound, refetch, back, backLabel }: {
  isLoading: boolean; isError: boolean; error: unknown; notFound: boolean; refetch: () => void; back: Route; backLabel: string;
}) {
  if (isLoading) return <Skeleton h={120} count={3} />;
  if (isError) return <ErrorText error={error} onRetry={refetch} />;
  if (notFound) return <NotFound text={t('resourceMissing')} back={back} backLabel={backLabel} />;
  return null;
}

export function NotFound({ text, back, backLabel }: { text: string; back: Route; backLabel: string }) {
  return (
    <div className="not-found">
      <Alert tone="info">{text}</Alert>
      <Button variant="secondary" onClick={() => navigate(back)}>{backLabel || t('navOverview')}</Button>
    </div>
  );
}
