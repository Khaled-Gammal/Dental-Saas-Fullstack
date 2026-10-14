export default function Landing() {
  const root = process.env.ROOT_DOMAIN ?? 'lvh.me';
  return (
    <main className="landing">
      <h1>منصة عيادات الأسنان</h1>
      <p className="muted">موقع إلكتروني ونظام إدارة لعيادتك في دقائق. Website and clinic management for dental clinics.</p>
      <h2>Demo clinics (local)</h2>
      <div className="grid">
        <a className="card" href={`http://clinic-a.${root}:3000`}>
          <strong>Smile Dental Clinic</strong>
          <span className="muted">clinic-a.{root}:3000</span>
        </a>
        <a className="card" href={`http://clinic-b.${root}:3000`}>
          <strong>Cairo Dental Care</strong>
          <span className="muted">clinic-b.{root}:3000</span>
        </a>
      </div>
      <a className="btn" href={process.env.DASHBOARD_URL}>Clinic dashboard</a>
    </main>
  );
}
