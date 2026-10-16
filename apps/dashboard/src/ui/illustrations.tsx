import { useEffect, useMemo, useRef } from 'react';
import { archGumPath, dentalArch, SPARKLE_PATH, TOOTH_PATH } from '@dental/ui/arch';

const GUM = archGumPath();

/**
 * Horseshoe dental arch of 14 teeth. `filled` teeth (counted from the incisors outward, alternating sides)
 * are painted solid with a sparkle: the dashboard uses it as a "complete your smile" progress picture.
 */
export function DentalArch({ filled = 0, className = '', label }: { filled?: number; className?: string; label?: string }) {
  const teeth = useMemo(() => dentalArch(14), []);
  // fill order: front teeth first, then outward, so progress grows like a smile
  const order = useMemo(() => teeth.map((_, i) => i).sort((a, b) => teeth[a].depth - teeth[b].depth || a - b), [teeth]);
  const lit = new Set(order.slice(0, Math.max(0, Math.min(14, Math.round(filled)))));

  return (
    <svg viewBox="0 0 320 200" className={`arch ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={GUM} className="arch-gum" fill="none" />
      {teeth.map((t, i) => (
        <g key={i} transform={t.transform} className={`arch-tooth${lit.has(i) ? ' lit' : ''}`} style={{ ['--i' as string]: String(order.indexOf(i)) }}>
          <path d={TOOTH_PATH} />
        </g>
      ))}
      {lit.size > 0 && (
        <g className="arch-sparkles">
          <path d={SPARKLE_PATH} transform="translate(160 6) scale(7)" />
          <path d={SPARKLE_PATH} transform="translate(214 22) scale(4)" />
          <path d={SPARKLE_PATH} transform="translate(110 20) scale(3)" />
        </g>
      )}
    </svg>
  );
}

type Particle = { x: number; y: number; r: number; vy: number; sway: number; phase: number; kind: 0 | 1 | 2; rot: number; vr: number; a: number };

/**
 * Ambient canvas for the auth panel: bubbles, small teeth and sparkles drifting up like rinse water.
 * Cheap by design: ~30 particles, DPR capped at 2, paused when the tab is hidden or the panel is off screen,
 * and a single still frame when the user prefers reduced motion.
 */
export function SmileCanvas({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tooth = new Path2D(TOOTH_PATH);
    const sparkle = new Path2D(SPARKLE_PATH);
    let w = 0, h = 0, raf = 0, last = 0, visible = true;
    let rect = canvas.getBoundingClientRect(); // cached: reading it on every pointermove would force layout
    const parts: Particle[] = [];
    const pointer = { x: 0.5, y: 0.5 };
    // colours come from the design tokens so the canvas follows any palette change
    const css = getComputedStyle(canvas);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const bubble = token('--navy-text', '#a9bedb'), toothInk = token('--sky-400', '#5bc0eb');

    const spawn = (anywhere: boolean): Particle => {
      const kind = (Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2) as Particle['kind'];
      return {
        x: Math.random() * w, y: anywhere ? Math.random() * h : h + 30,
        r: kind === 0 ? 3 + Math.random() * 10 : kind === 1 ? 0.7 + Math.random() * 0.9 : 3 + Math.random() * 5,
        vy: 8 + Math.random() * 18, sway: 6 + Math.random() * 14, phase: Math.random() * Math.PI * 2,
        kind, rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 0.2, a: 0.25 + Math.random() * 0.45,
      };
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      rect = canvas.getBoundingClientRect();
      if (rect.width === w && rect.height === h) return; // ResizeObserver also fires once on mount
      w = rect.width; h = rect.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // keep the particles already on screen; only top up or trim to the density for the new size
      const target = Math.round(Math.min(36, Math.max(14, (w * h) / 16000)));
      for (const p of parts) p.x = Math.min(p.x, w);
      while (parts.length < target) parts.push(spawn(true));
      parts.length = target;
      if (reduce) draw(0);
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h);
      const px = (pointer.x - 0.5) * 14, py = (pointer.y - 0.5) * 10; // gentle parallax toward the pointer
      for (const p of parts) {
        p.y -= p.vy * dt; p.phase += dt * 0.8; p.rot += p.vr * dt;
        if (p.y < -40) Object.assign(p, spawn(false));
        const depth = p.kind === 1 ? p.r : p.r / 10;
        const x = p.x + Math.sin(p.phase) * p.sway + px * depth, y = p.y + py * depth;
        const fade = Math.min(1, y / (h * 0.25), (h - y) / (h * 0.2) + 0.2); // fade in at the bottom, out at the top
        ctx.globalAlpha = Math.max(0, p.a * fade);
        ctx.save();
        ctx.translate(x, y);
        if (p.kind === 0) {
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2);
          ctx.strokeStyle = bubble; ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath(); ctx.arc(-p.r * 0.35, -p.r * 0.35, p.r * 0.22, 0, Math.PI * 2); // bubble highlight
          ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
        } else if (p.kind === 1) {
          ctx.rotate(p.rot); ctx.scale(p.r, p.r); ctx.translate(-12, -12);
          ctx.strokeStyle = toothInk; ctx.lineWidth = 1.6 / p.r; ctx.stroke(tooth);
        } else {
          ctx.rotate(p.rot); ctx.scale(p.r, p.r);
          ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill(sparkle);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (!reduce && visible && !document.hidden && !raf) { last = 0; raf = requestAnimationFrame(loop); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    const onMove = (e: PointerEvent) => {
      if (!rect.width || !rect.height) return;
      pointer.x = (e.clientX - rect.left) / rect.width; pointer.y = (e.clientY - rect.top) / rect.height;
    };
    if (!reduce) window.addEventListener('pointermove', onMove, { passive: true }); // parallax only when animating
    resize();
    start();
    return () => {
      stop(); ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
