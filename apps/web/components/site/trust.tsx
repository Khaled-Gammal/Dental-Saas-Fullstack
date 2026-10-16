import { Icon } from '../icons';
import { arNoun, NOUNS, type SiteData } from '../../lib/site';
import type { Contact } from './contact';

/** Counts come straight from the catalogue; nothing here is a claim the data cannot back. */
export function TrustIndicators({ site, contact }: { site: SiteData; contact: Contact }) {
  const { doctors, services, branches } = site;
  const priced = services.filter((s) => s.price_minor > 0).length;
  const items: { icon: 'user' | 'toothSparkle' | 'pin' | 'whatsapp' | 'check'; value: string; label: string }[] = [];
  if (doctors.length) items.push({ icon: 'user', value: String(doctors.length), label: arNoun(doctors.length, NOUNS.doctor) });
  if (services.length) items.push({ icon: 'toothSparkle', value: String(services.length), label: arNoun(services.length, NOUNS.service) });
  if (branches.length) items.push({ icon: 'pin', value: String(branches.length), label: arNoun(branches.length, NOUNS.branch) });
  if (priced > 0) items.push({ icon: 'check', value: 'أسعار معلنة', label: 'بلا مفاجآت' });
  else if (contact.whatsapp) items.push({ icon: 'whatsapp', value: 'واتساب', label: 'حجز سريع' });
  if (items.length < 2) return null;
  return (
    <section className="s-trust" aria-label="عن العيادة">
      <ul className="s-wrap s-trust-in" data-reveal>
        {items.map((it) => (
          <li key={it.icon} className="s-stat">
            <span className="s-stat-icon"><Icon name={it.icon} size={22} /></span>
            <span><strong>{it.value}</strong><span>{it.label}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
