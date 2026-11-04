'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons';

export interface NavLink { href: string; label: string }

/**
 * The header's menu on small screens: a panel under the floating bar with the section links and the booking actions.
 * Closes on Escape, on a link, on a tap outside the bar, and when the screen grows past the breakpoint.
 */
export function MobileMenu({ links, actions }: { links: NavLink[]; actions: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const bar = button.current?.closest('.c-nav-bar');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (bar && !bar.contains(e.target as Node)) setOpen(false); };
    const mq = window.matchMedia('(min-width: 961px)');
    const onGrow = () => { if (mq.matches) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    mq.addEventListener('change', onGrow);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); mq.removeEventListener('change', onGrow); };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <>
      <button ref={button} type="button" className="c-icon-btn c-menu-btn" aria-expanded={open} aria-controls={id} aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'close' : 'menu'} size={22} />
      </button>
      <div id={id} className="c-menu" hidden={!open}>
        {links.length > 0 && (
          <nav aria-label="أقسام الموقع">
            {links.map((l) => <a key={l.href} href={l.href} className="c-menu-link" onClick={close}>{l.label}<Icon name="arrow" size={18} /></a>)}
          </nav>
        )}
        {actions.length > 0 && (
          <div className="c-menu-actions">
            {actions.map((a, i) => <a key={a.href} href={a.href} className={`c-btn${i ? ' c-btn-ghost' : ''}`} onClick={close}>{a.label}</a>)}
          </div>
        )}
      </div>
    </>
  );
}
