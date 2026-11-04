import { useEffect, useId, useLayoutEffect, useRef, useState, type AnchorHTMLAttributes, type FormEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { navigate } from '../hooks';
import { href, type Route } from '../router';
import { Alert, Button, ErrorText, Skeleton } from './components';
import { CheckIcon, EditIcon } from './icons';
import { fmtNumber } from '../util';
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
    <Breadcrumb aria-label="مسار الصفحة" className="-mb-2">
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
 * The one layout for every create/edit screen (2026-11-04, the websites' design), across the page's full width: a header
 * panel with the page's icon in an arch, its breadcrumbs, title and line; the form's sections (FormSection) with, beside
 * them, either the page's own side column (`aside`: a summary of what is being made) or a guide to the sections that
 * follows the scroll; and a floating bar with Cancel + Save. The caller owns the state; this owns the chrome.
 */
export function FormPage({ title, sub, icon, crumbs, back, onSubmit, saving, canSave, error, notice, children, extra, saveLabel, aside }: {
  title: string; sub?: ReactNode; crumbs: Crumb[]; back: Route; onSubmit: (e: FormEvent) => void;
  /** the header's icon: what is being made or changed (a pencil when none is given) */
  icon?: ReactNode;
  saving: boolean; canSave: boolean; error?: unknown; notice?: ReactNode; children: ReactNode; extra?: ReactNode;
  /** the save button's words when "save" is not what happens (a new invoice is created as a draft) */
  saveLabel?: string;
  /** a side column beside the form (a summary of what is being made); below it on narrow screens */
  aside?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const sections = useFormSections(form, !aside);
  const side = !!aside || sections.list.length > 1; // the guide is worth its column from two sections up
  useEffect(() => {
    // a new page: tell screen readers where we are, unless a field already took focus (autoFocus on create pages)
    const a = document.activeElement;
    if (!a || a === document.body || a.id === 'main') heading.current?.focus();
  }, []);
  return (
    <div className="form-layout">
      <header className="form-hero">
        <Breadcrumbs items={crumbs} />
        <div className="form-hero-main">
          <span className="form-hero-icon" aria-hidden>{icon ?? <EditIcon size={24} />}</span>
          <div className="page-head-text">
            <h1 ref={heading} tabIndex={-1}>{title}</h1>
            {sub && <p>{sub}</p>}
          </div>
          {extra && <div className="page-actions">{extra}</div>}
        </div>
      </header>
      <form ref={form} onSubmit={onSubmit} className={`form-page${side ? ' has-aside' : ''}`} noValidate>
        <div className="stack">{children}</div>
        {aside ? <aside className="form-aside">{aside}</aside> : side && <FormGuide sections={sections.list} active={sections.active} onChoose={sections.choose} />}
        {notice}
        <ErrorText error={error} />
        <div className="form-footer">
          <Button variant="ghost" onClick={() => navigate(back)}>إلغاء</Button>
          <Button type="submit" loading={saving} disabled={!canSave}>{!saving && <CheckIcon size={18} />}{saveLabel ?? 'حفظ'}</Button>
        </div>
      </form>
    </div>
  );
}

/**
 * One part of a create/edit form: a card whose header carries its number (counted in CSS, so a part that appears or
 * goes renumbers the rest), the title, an optional line and an optional action on the other side. `done` turns the
 * number into a check (the booking's parts as they are filled). FormPage lists the parts in its side guide.
 */
export function FormSection({ title, sub, action, done, className = '', children }: {
  title: string; sub?: ReactNode; action?: ReactNode; done?: boolean; className?: string; children: ReactNode;
}) {
  const id = `fs-${useId().replace(/[^a-z0-9]/gi, '')}`;
  return (
    <section className={`card form-section ${className}`.trim()} id={id} data-title={title} aria-labelledby={`${id}-t`}>
      <header className="form-section-head">
        <span className={`form-section-num${done ? ' is-done' : ''}`} aria-hidden>{done && <CheckIcon size={15} />}</span>
        <div className="form-section-titles">
          <h2 id={`${id}-t`} tabIndex={-1}>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action && <div className="form-section-action">{action}</div>}
      </header>
      {children}
    </section>
  );
}

interface SectionRef { id: string; title: string }

/**
 * The form's parts in page order (they may appear and go as the form changes), and the one being read now. Read before
 * the first paint (layout effect), so a page with a guide opens with its side column instead of growing one a frame later.
 */
function useFormSections(form: RefObject<HTMLFormElement | null>, enabled: boolean) {
  const [list, setList] = useState<SectionRef[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const chosen = useRef<string | null>(null); // a part picked in the guide stays marked while the page scrolls to it
  useLayoutEffect(() => {
    const root = form.current;
    if (!root || !enabled) return;
    const read = () => {
      const next = [...root.querySelectorAll<HTMLElement>('.form-section')].map((el) => ({ id: el.id, title: el.dataset.title ?? '' }));
      setList((old) => (old.length === next.length && old.every((s, i) => s.id === next[i].id && s.title === next[i].title) ? old : next));
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [form, enabled]);
  useEffect(() => {
    if (!list.length) return;
    let frame = 0;
    // the part whose top has passed under the floating bar; the last one once the page is scrolled to its end (a page
    // short enough not to scroll is at its end from the start, and keeps the first part)
    const update = () => {
      frame = 0;
      if (chosen.current && list.some((s) => s.id === chosen.current)) { setActive(chosen.current); return; }
      const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = list[0].id;
      for (const s of list) if ((document.getElementById(s.id)?.getBoundingClientRect().top ?? Infinity) <= 140) current = s.id;
      setActive(atEnd ? list[list.length - 1].id : current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    // the reader scrolling by themselves (wheel, touch, keys, a click) hands the mark back to the scroll position; a
    // click on the guide also starts with a press, so its choice is made after this
    const release = () => { chosen.current = null; };
    const input = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    for (const e of input) window.addEventListener(e, release, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      for (const e of input) window.removeEventListener(e, release);
      cancelAnimationFrame(frame);
    };
  }, [list]);
  const choose = (id: string) => { chosen.current = id; setActive(id); };
  return { list, active, choose };
}

/** The side guide: the form's parts, the one in view marked; choosing one marks it, scrolls to it and moves the focus there. */
function FormGuide({ sections, active, onChoose }: { sections: SectionRef[]; active: string | null; onChoose: (id: string) => void }) {
  const go = (id: string) => {
    onChoose(id);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    document.getElementById(`${id}-t`)?.focus({ preventScroll: true });
  };
  return (
    <nav className="form-aside form-guide" aria-labelledby="form-guide-title">
      <strong id="form-guide-title" className="form-guide-title">أقسام النموذج</strong>
      <ol>
        {sections.map((s, i) => (
          <li key={s.id}>
            <button type="button" className={s.id === active ? 'is-on' : undefined} aria-current={s.id === active ? 'location' : undefined} onClick={() => go(s.id)}>
              <span aria-hidden>{fmtNumber(i + 1)}</span>{s.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Loading / error / missing states for a page that edits one resource. */
export function ResourceState({ isLoading, isError, error, notFound, refetch, back, backLabel }: {
  isLoading: boolean; isError: boolean; error: unknown; notFound: boolean; refetch: () => void; back: Route; backLabel: string;
}) {
  if (isLoading) return <Skeleton h={120} count={3} />;
  if (isError) return <ErrorText error={error} onRetry={refetch} />;
  if (notFound) return <NotFound text="هذا العنصر غير موجود أو تم حذفه" back={back} backLabel={backLabel} />;
  return null;
}

export function NotFound({ text, back, backLabel }: { text: string; back: Route; backLabel: string }) {
  return (
    <div className="not-found">
      <Alert tone="info">{text}</Alert>
      <Button variant="secondary" onClick={() => navigate(back)}>{backLabel || 'نظرة عامة'}</Button>
    </div>
  );
}
