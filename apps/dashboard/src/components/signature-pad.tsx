import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/components';

/**
 * A box to sign in with a finger, a pen or a mouse (H9, DSH-16). Drawn at the screen's pixel density so the signature
 * stays sharp; `onChange` gets a PNG data URL after each stroke, or null when the box is empty again.
 */
export function SignaturePad({ onChange, label }: { onChange: (png: string | null) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * ratio);
    c.height = Math.round(height * ratio);
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#14213d';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01); // a tap leaves a dot
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(canvas.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="signature">
      <canvas ref={canvas} className="signature-box" aria-label={label} role="img"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      <div className="row-between">
        <span className="muted small">{empty ? 'وقّع داخل المربع بإصبعك أو بالقلم.' : 'تم التوقيع.'}</span>
        <Button variant="ghost" onClick={clear} disabled={empty}>امسح وأعد التوقيع</Button>
      </div>
    </div>
  );
}
