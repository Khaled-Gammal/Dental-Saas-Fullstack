import { initials } from '@dental/ui/text';
import { imageProps } from '../../lib/media';
import { ar, specialtyLabel, type SiteDoctor } from '../../lib/site';
import { bookingLink, type Contact } from './contact';
import { Section } from './decor';
import { viaIcon } from './services';

/**
 * A doctor: the photo in an arch-shaped frame (or their initials on the brand colour), name, title, specialties, bio
 * and a booking action naming them. In a wide column (one or two doctors) the card lays out sideways (a container query).
 */
export function DoctorCard({ doctor, contact, clinicName }: { doctor: SiteDoctor; contact: Contact; clinicName: string }) {
  const name = ar(doctor.name_ar, doctor.name_en) ?? '';
  const title = ar(doctor.title_ar, doctor.title_en);
  const bio = ar(doctor.bio_ar, doctor.bio_en);
  const link = bookingLink(contact, `مرحبًا، أود حجز موعد مع ${name} في ${clinicName}.`);
  const book = link?.via === 'online' ? { ...link, href: `${link.href}?doctor=${doctor.id}` } : link; // the wizard opens with this doctor chosen
  return (
    <article className="c-card c-doc" data-reveal>
      <div className="c-doc-in">
        <div className="c-doc-portrait">
          {doctor.photo
            ? <img {...imageProps(doctor.photo, 640)} sizes="(max-width: 639px) 100vw, 380px" alt="" loading="lazy" decoding="async" />
            : <span className="c-doc-initials" aria-hidden><span>{initials(name)}</span></span>}
        </div>
        <div className="c-doc-body">
          <h3><bdi>{name}</bdi></h3>
          {title && <p className="c-doc-title">{title}</p>}
          {doctor.specialties.length > 0 && (
            <ul className="c-tags" aria-label="التخصصات">
              {doctor.specialties.slice(0, 3).map((s) => <li key={s} className="c-chip"><bdi>{specialtyLabel(s)}</bdi></li>)}
            </ul>
          )}
          {bio && <p className="c-doc-bio">{bio}</p>}
          {book && <a className="c-btn c-btn-soft c-doc-book" href={book.href} aria-label={`احجز موعدًا مع ${name}`}>{viaIcon(book.via)}احجز مع الطبيب</a>}
        </div>
      </div>
    </article>
  );
}

export function DoctorsSection({ doctors, contact, clinicName, tint, title = 'أطباء تثق بهم', sub = 'اختر الطبيب المناسب لحالتك واحجز معه مباشرة.' }: { doctors: SiteDoctor[]; contact: Contact; clinicName: string; tint?: boolean; title?: string; sub?: string }) {
  if (!doctors.length) return null;
  return (
    <Section id="doctors" kicker="فريقنا" title={title} sub={sub} tint={tint}>
      <div className="c-docs" data-count={Math.min(doctors.length, 4)}>
        {doctors.map((d) => <DoctorCard key={d.id} doctor={d} contact={contact} clinicName={clinicName} />)}
      </div>
    </Section>
  );
}
