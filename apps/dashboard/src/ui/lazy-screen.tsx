import { Component, lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Button, Card, Skeleton } from './components';

const RELOADED = 'screen-chunk-reload';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the bound React's own lazy() puts on a component
type AnyComponent = ComponentType<any>;

/**
 * A screen loaded the first time it is opened (redesign R5: the dashboard was one 1.8 MB file). After a deploy the
 * old file names are gone and the import fails: reload once to get the new ones, never in a loop.
 */
export function lazyScreen<M extends Record<K, AnyComponent>, K extends keyof M & string>(load: () => Promise<M>, name: K): LazyExoticComponent<M[K]> {
  return lazy(async () => {
    try {
      const m = await load();
      try { sessionStorage.removeItem(RELOADED); } catch { /* storage blocked: nothing to clear */ }
      return { default: m[name] };
    } catch (error) {
      let again = false;
      try { again = sessionStorage.getItem(RELOADED) === '1'; sessionStorage.setItem(RELOADED, '1'); } catch { again = true; }
      if (!again) { window.location.reload(); return new Promise<never>(() => {}); }
      throw error; // the boundary below says so and offers a reload
    }
  });
}

/** While a screen's file loads (usually a moment, once). */
export function ScreenLoading() {
  return <div role="status" aria-label="جارٍ التحميل…"><Skeleton h={72} count={3} /></div>;
}

/**
 * One screen failing (its file would not load, or it threw while drawing) shows a card instead of a blank app; the
 * menu stays usable. `resetKey` (the route) clears it when the member moves to another page.
 */
export class ScreenBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() { return { failed: true }; }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  render() {
    if (!this.state.failed) return <Suspense fallback={<ScreenLoading />}>{this.props.children}</Suspense>;
    return (
      <Card>
        <h2>تعذّر فتح هذه الصفحة</h2>
        <p className="muted">ربما صدر تحديث للنظام أو انقطع الاتصال. أعد تحميل الصفحة؛ لن يضيع شيء محفوظ.</p>
        <div className="row-end mt-sm"><Button onClick={() => window.location.reload()}>إعادة تحميل الصفحة</Button></div>
      </Card>
    );
  }
}
