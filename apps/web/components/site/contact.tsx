import { telHref } from '@dental/ui/text';
import { whatsappHref, type SiteData } from '../../lib/site';

/**
 * The booking channels a clinic actually offers: the online wizard when the clinic has bookable services and
 * doctors who accept online booking, plus a phone call and/or a WhatsApp chat. Nothing here fakes a confirmation.
 */
export interface Contact {
  /** the website's own booking wizard, or null when the clinic has nothing bookable online */
  bookUrl: string | null;
  phone: string | null;
  tel: string | null;
  /** the raw WhatsApp number, so sections can prefill a message that names the service or doctor */
  waNumber: string | null;
  whatsapp: string | null;
}

export function contactFor(clinic: SiteData['clinic'], name: string, onlineBooking = false): Contact {
  const phone = clinic.primary_phone;
  const waNumber = clinic.whatsapp ?? phone;
  const whatsapp = whatsappHref(waNumber, `مرحبًا، أود حجز موعد في ${name}.`);
  return { bookUrl: onlineBooking ? '/book' : null, phone, tel: telHref(phone), waNumber: whatsapp ? waNumber : null, whatsapp };
}

/** The primary booking action: the wizard first, then WhatsApp with a message naming the service or doctor, then a call. */
export function bookingLink(contact: Contact, message: string): { href: string; via: 'online' | 'whatsapp' | 'tel' } | null {
  if (contact.bookUrl) return { href: contact.bookUrl, via: 'online' };
  const wa = whatsappHref(contact.waNumber, message);
  if (wa) return { href: wa, via: 'whatsapp' };
  if (contact.tel) return { href: contact.tel, via: 'tel' };
  return null;
}
