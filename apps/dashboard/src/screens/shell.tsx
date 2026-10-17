import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { pickName } from '@dental/ui/text';
import { can, logout, type Session } from '../api';
import { roleLabel, t, type Key, type Lang } from '../i18n';
import { Badge, LinkButton, Logo, initials } from '../ui/components';
import { CalendarIcon, CloseIcon, GlobeIcon, HomeIcon, ImageIcon, LangIcon, ListIcon, LogoutIcon, MenuIcon, PhoneIcon, PinIcon, ReceiptIcon, ShieldIcon, StethoscopeIcon, ToothIcon, UsersIcon } from '../ui/icons';
import { useProfile } from '../queries';
import { useMediaQuery } from '../hooks';
import { to, type Page } from '../router';
import { RouteLink } from '../ui/page';

/** `perm`: shown only to members who hold it (the page refuses others anyway). */
type NavItem = { key: Key; icon: ReactNode; page?: Page; perm?: string };
const NAV: NavItem[] = [
  { key: 'navOverview', icon: <HomeIcon />, page: 'overview' },
  { key: 'navProfile', icon: <ToothIcon />, page: 'profile' },
  { key: 'navBranches', icon: <PinIcon />, page: 'branches' },
  { key: 'navAppointments', icon: <CalendarIcon />, page: 'appointments' },
  { key: 'navPatients', icon: <UsersIcon />, page: 'patients' },
  { key: 'navFollowUps', icon: <PhoneIcon />, page: 'followups', perm: 'patients:read' },
  { key: 'navDoctors', icon: <StethoscopeIcon />, page: 'doctors' },
  { key: 'navServices', icon: <ListIcon />, page: 'services' },
  { key: 'navStaff', icon: <ShieldIcon />, page: 'staff', perm: 'staff:manage' },
  { key: 'navBilling', icon: <ReceiptIcon />, page: 'invoices', perm: 'invoices:read' },
  { key: 'navGallery', icon: <ImageIcon />, page: 'gallery' },
  { key: 'navWebsite', icon: <GlobeIcon /> },
];

export const clinicName = (session: Session, lang: Lang) => pickName(lang, session.clinic.nameAr, session.clinic.nameEn, session.clinic.slug);

export function AppShell({ lang, onLang, session, page, children }: {
  lang: Lang; onLang: () => void; session: Session; page: Page | 'not-found'; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const isDrawer = useMediaQuery('(max-width: 960px)'); // must match the drawer breakpoint in styles.css
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    // move focus into the drawer when it opens and back to the menu button when it closes
    if (open) closeBtn.current?.focus();
    else if (wasOpen.current) menuBtn.current?.focus();
    wasOpen.current = open;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const skipToMain = (e: MouseEvent) => {
    e.preventDefault(); // a plain #main link would change the hash route
    document.getElementById('main')?.focus();
  };

  // the profile query is updated on save, so a renamed clinic shows everywhere at once
  const profile = useProfile(session.clinic.id).data;
  const name = profile ? pickName(lang, profile.nameAr, profile.nameEn, session.clinic.slug) : clinicName(session, lang);
  return (
    <div className={`app${open ? ' nav-open' : ''}`}>
      <a href="#main" className="skip" onClick={skipToMain}>{t('skipToContent', lang)}</a>
      {/* a closed drawer is inert: hidden off screen, so it must not be reachable with Tab either */}
      <aside className="sidebar" id="sidebar" inert={isDrawer && !open} aria-modal={isDrawer && open ? true : undefined} role={isDrawer && open ? 'dialog' : undefined}
        aria-label={isDrawer && open ? t('menu', lang) : undefined}>
        <div className="sidebar-head">
          <Logo name={t('brand', lang)} light />
          <button ref={closeBtn} className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label={t('closeMenu', lang)}><CloseIcon /></button>
        </div>
        <div className="clinic-chip">
          <span className="avatar avatar-sq">{initials(name)}</span>
          <span className="clinic-chip-text">
            <strong><bdi>{name}</bdi></strong>
            <small dir="ltr">{session.clinic.slug}</small>
          </span>
        </div>
        <nav aria-label={t('mainNav', lang)}>
          <ul className="nav">
            {NAV.filter((n) => !n.perm || can(session, n.perm)).map((n) => (
              <li key={n.key}>
                {n.page ? (
                  <RouteLink route={to.list(n.page)} className={`nav-item${page === n.page ? ' active' : ''}`} aria-current={page === n.page ? 'page' : undefined}
                    onClick={() => setOpen(false)}>
                    {n.icon}<span>{t(n.key, lang)}</span>
                  </RouteLink>
                ) : (
                  <span className="nav-item disabled" aria-disabled="true">
                    {n.icon}<span>{t(n.key, lang)}</span><span className="nav-soon">{t('soon', lang)}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => void logout()}><LogoutIcon /><span>{t('signOut', lang)}</span></button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden />

      <div className="main-col">
        <header className="topbar">
          <button ref={menuBtn} className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label={t('menu', lang)} aria-controls="sidebar" aria-expanded={open}><MenuIcon /></button>
          <span className="topbar-title"><bdi>{name}</bdi></span>
          {session.clinic.status === 'trialing' && <Badge tone="warning">{t('trial', lang)}</Badge>}
          <span className="spacer" />
          <LinkButton onClick={onLang} lang={lang === 'ar' ? 'en' : 'ar'}><LangIcon size={18} /><span className="hide-sm">{t('switchLang', lang)}</span></LinkButton>
          <div className="user">
            <span className="avatar">{initials(session.user.name)}</span>
            <span className="user-text hide-sm">
              <strong><bdi>{session.user.name}</bdi></strong>
              <small>{roleLabel(session.clinic.role, lang)}</small>
            </span>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
