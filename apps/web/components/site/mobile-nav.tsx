'use client';
import { useEffect, useId, useState } from 'react';
import { Icon } from '../icons';

export interface NavLink { href: string; label: string }

/**
 * The only client component on the site: a menu button for small screens.
 * Closes on Escape, on link click and when the viewport grows past the mobile breakpoint.
 */
export function MobileNav({ links, actions }: { links: NavLink[]; actions: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const mq = window.matchMedia('(min-width: 761px)');
    const onGrow = () => { if (mq.matches) setOpen(false); };
    window.addEventListener('keydown', onKey);
    mq.addEventListener('change', onGrow);
    return () => { window.removeEventListener('keydown', onKey); mq.removeEventListener('change', onGrow); };
  }, [open]);

  return (
    <>
      <button type="button" className="s-menu-btn" aria-expanded={open} aria-controls={id} aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'close' : 'menu'} size={22} />
      </button>
      <div id={id} className="s-menu" hidden={!open}>
        <nav aria-label="أقسام الموقع">
          {links.map((l) => <a key={l.href} href={l.href} className="s-menu-link" onClick={() => setOpen(false)}>{l.label}</a>)}
        </nav>
        {actions.length > 0 && (
          <div className="s-menu-actions">
            {actions.map((a, i) => <a key={a.href} href={a.href} className={`s-btn${i ? ' s-btn-ghost' : ''}`} onClick={() => setOpen(false)}>{a.label}</a>)}
          </div>
        )}
      </div>
    </>
  );
}
