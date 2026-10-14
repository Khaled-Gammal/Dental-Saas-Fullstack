import { notFound } from 'next/navigation';

interface SiteData {
  clinic: { slug: string; name_en: string | null; name_ar: string | null; about_ar: string | null; about_en: string | null; primary_phone: string | null };
  theme: { primary?: string };
  showPoweredBy: boolean;
  branches: { id: string; name_ar: string | null; name_en: string | null; address_ar: string | null; phone: string | null;
    hours: { weekday: number; opens_at: string; closes_at: string }[] }[];
  services: { id: string; name_ar: string | null; name_en: string | null; price_minor: number; price_max_minor: number | null; duration_minutes: number }[];
  doctors: { id: string; name_ar: string | null; name_en: string | null; title_ar: string | null }[];
}

const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const egp = (minor: number) => new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(minor / 100);

async function getSite(host: string): Promise<SiteData | null> {
  const res = await fetch(`${process.env.API_INTERNAL_URL}/public/site?host=${encodeURIComponent(host)}`, {
    next: { revalidate: 60, tags: [`site:${host}`] }, // the worker will call revalidateTag on publish / catalog change
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export default async function ClinicSite({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const site = await getSite(decodeURIComponent(host));
  if (!site) notFound();
  const { clinic } = site;
  const color = site.theme.primary ?? '#0e7c86';

  return (
    <main style={{ ['--brand' as string]: color }}>
      <h1>{clinic.name_ar ?? clinic.name_en}</h1>
      <p className="muted">{clinic.about_ar ?? clinic.about_en}</p>
      {clinic.primary_phone && <a className="btn" href={`tel:${clinic.primary_phone}`}>احجز الآن · {clinic.primary_phone}</a>}

      <h2>الخدمات</h2>
      <div className="grid">
        {site.services.map((s) => (
          <div className="card" key={s.id}>
            <strong>{s.name_ar ?? s.name_en}</strong>
            <span className="muted">
              {s.price_max_minor ? `${egp(s.price_minor)} – ${egp(s.price_max_minor)}` : egp(s.price_minor)} · {s.duration_minutes} دقيقة
            </span>
          </div>
        ))}
      </div>

      <h2>الأطباء</h2>
      <div className="grid">
        {site.doctors.map((d) => (
          <div className="card" key={d.id}>
            <strong>{d.name_ar ?? d.name_en}</strong>
            <span className="muted">{d.title_ar}</span>
          </div>
        ))}
      </div>

      <h2>الفروع ومواعيد العمل</h2>
      <div className="grid">
        {site.branches.map((b) => (
          <div className="card" key={b.id}>
            <strong>{b.name_ar ?? b.name_en}</strong>
            <span className="muted">{b.address_ar}</span>
            <ul className="muted">
              {[...new Set(b.hours.map((h) => h.weekday))].map((day) => (
                <li key={day}>
                  {DAYS_AR[day]}: {b.hours.filter((h) => h.weekday === day).map((h) => `${h.opens_at.slice(0, 5)}–${h.closes_at.slice(0, 5)}`).join('، ')}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {site.showPoweredBy && <footer>Powered by Dental SaaS</footer>}
    </main>
  );
}
