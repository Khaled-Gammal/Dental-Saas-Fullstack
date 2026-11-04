import { Icon, type IconName } from '../icons';

/**
 * How the platform works, from sign-up to the first online booking: numbered stops along a dashed wave (a vertical line
 * on phones). The stops are an ordered list, so a screen reader hears the order too.
 */
export function Journey({ items }: { items: { icon: IconName; title: string; text: string }[] }) {
  return (
    <div className="l-journey">
      <svg className="l-journey-line" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden focusable="false">
        <path d="M0 60C125 0 250 0 375 60S625 120 750 60 875 0 1000 60" />
      </svg>
      <ol className="l-steps">
        {items.map((s, i) => (
          <li key={s.title} className="l-step" data-reveal>
            <span className="l-step-badge" aria-hidden><Icon name={s.icon} size={28} /><b>{i + 1}</b></span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
