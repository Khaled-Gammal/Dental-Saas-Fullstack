import { initials } from '@dental/ui/text';
import { Chat, Icon, Phone } from '../icons';
import { imageProps } from '../../lib/media';
import { ar, specialtyLabel, type SiteDoctor } from '../../lib/site';
import { bookingLink, type Contact } from './contact';
import { Section } from './decor';

export function DoctorCard({ doctor, contact, clinicName }: { doctor: SiteDoctor; contact: Contact; clinicName: string }) {
  const name = ar(doctor.name_ar, doctor.name_en) ?? '';
  const title = ar(doctor.title_ar, doctor.title_en);
  const bio = ar(doctor.bio_ar, doctor.bio_en);
  const link = bookingLink(contact, `مرحبًا، أود حجز موعد مع ${name} في ${clinicName}.`);
  const book = link?.via === 'online' ? { ...link, href: `${link.href}?doctor=${doctor.id}` } : link; // the wizard opens with this doctor chosen
  return (
    <article className="s-card s-doctor" data-reveal>
      {/* the doctor's photo, or their initials on the brand colour when none was uploaded */}
      {doctor.photo
        ? <img className="s-avatar s-avatar-photo" {...imageProps(doctor.photo, 320)} sizes="112px" alt="" loading="lazy" decoding="async" />
        : <span className="s-avatar" aria-hidden>{initials(name)}</span>}
      <h3><bdi>{name}</bdi></h3>
      {title && <p className="s-doctor-title">{title}</p>}
      {doctor.specialties.length > 0 && (
        <ul className="s-tags" aria-label="التخصصات">
          {doctor.specialties.slice(0, 3).map((s) => <li key={s} className="s-tag"><bdi>{specialtyLabel(s)}</bdi></li>)}
        </ul>
      )}
      {bio && <p className="s-bio">{bio}</p>}
      {book && <a className="s-btn s-btn-soft s-card-cta" href={book.href} aria-label={`احجز موعدًا مع ${name}`}>{book.via === 'online' ? <Icon name="calendar" size={16} /> : book.via === 'whatsapp' ? <Chat size={16} /> : <Phone size={16} />}احجز مع الطبيب</a>}
    </article>
  );
}

export function DoctorsSection({ doctors, contact, clinicName }: { doctors: SiteDoctor[]; contact: Contact; clinicName: string }) {
  if (!doctors.length) return null;
  return (
    <Section id="doctors" kicker="فريقنا" title="أطباء تثق بهم" sub="اختر الطبيب المناسب لحالتك واحجز معه مباشرة" tint>
      <div className="s-grid s-grid-doctors">
        {doctors.map((d) => <DoctorCard key={d.id} doctor={d} contact={contact} clinicName={clinicName} />)}
      </div>
    </Section>
  );
}
