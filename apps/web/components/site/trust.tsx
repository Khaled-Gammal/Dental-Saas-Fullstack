import { Icon, type IconName } from '../icons';
import { arNoun, NOUNS, type SiteData } from '../../lib/site';
import type { Contact } from './contact';

/**
 * The clinic at a glance, under the hero. Counts come straight from the catalogue; nothing here is a claim the data
 * cannot back. Shown only with two facts or more.
 */
export function TrustIndicators({ site, contact }: { site: SiteData; contact: Contact }) {
  const { doctors, services, branches } = site;
  const priced = services.filter((s) => s.price_minor > 0).length;
  const items: { key: string; icon: IconName; value: string; label: string; text?: boolean }[] = [];
  if (doctors.length) items.push({ key: 'doctors', icon: 'user', value: String(doctors.length), label: arNoun(doctors.length, NOUNS.doctor) });
  if (services.length) items.push({ key: 'services', icon: 'toothSparkle', value: String(services.length), label: arNoun(services.length, NOUNS.service) });
  if (branches.length) items.push({ key: 'branches', icon: 'pin', value: String(branches.length), label: arNoun(branches.length, NOUNS.branch) });
  if (priced > 0) items.push({ key: 'prices', icon: 'check', value: 'أسعار معلنة', label: 'بلا مفاجآت', text: true });
  else if (contact.whatsapp) items.push({ key: 'whatsapp', icon: 'whatsapp', value: 'واتساب', label: 'حجز سريع', text: true });
  if (items.length < 2) return null;
  return (
    <section className="c-facts" aria-label="عن العيادة">
      <div className="c-wrap">
        <ul className="c-facts-list" data-count={items.length}>
          {items.map((it) => (
            <li key={it.key} className={`c-fact${it.text ? ' is-text' : ''}`}>
              <span className="c-fact-icon"><Icon name={it.icon} size={22} /></span>
              <span className="c-fact-text"><strong>{it.value}</strong><span>{it.label}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
