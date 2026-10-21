import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ApiError, uploadFile } from '../api';
import { ACCEPT_ATTR, imageSrcSet, uploadProblem } from '../gallery-model';
import type { MediaImage, MediaPurpose } from '../types';
import { Button } from '../ui/components';
import { ImageIcon } from '../ui/icons';
import { uploadErrorText } from './image-uploader';

/**
 * One image on a record (doctor photo, service image, branch photo, clinic logo). Picking or dropping a file uploads
 * it at once (`?purpose=photo|logo`), and `onChange` hands the stored image to the form; nothing is attached until
 * the form is saved, so leaving without saving changes nothing (the unused upload is purged overnight).
 * `shape` only changes the preview: a circle for people, a wide card for places and services, a contained logo.
 */
export function ImageField({ purpose, value, onChange, label, hint, shape, placeholder, disabled }: {
  purpose: Exclude<MediaPurpose, 'gallery'>; value: MediaImage | null; onChange: (img: MediaImage | null) => void;
  label: string; hint?: string; shape: 'circle' | 'wide' | 'logo'; placeholder?: ReactNode; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // the local file while it uploads
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []); // leaving the form stops an upload in flight
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(file: File) {
    setError(null);
    const problem = uploadProblem(file);
    if (problem) { setError(problem === 'type' ? 'يُقبل JPG وPNG وWebP فقط.' : 'الملف أكبر من 10 ميجابايت.'); return; }
    const local = URL.createObjectURL(file);
    setPreview(local);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const img = await uploadFile<MediaImage>(`/media?purpose=${purpose}`, file, setProgress, abort.current.signal);
      onChange(img);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'aborted')) setError(uploadErrorText(e, purpose));
    } finally {
      setProgress(null);
      setPreview(null);
    }
  }

  const busy = progress !== null;
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && !busy && !disabled) void pick(f);
  };
  const src = preview ?? value?.thumbUrl;

  return (
    <fieldset className={`image-field is-${shape}`} disabled={disabled}>
      <legend>{label}</legend>
      <div className={`image-field-preview${dragging ? ' is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); if (!busy && !disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        {src
          ? <img src={src} srcSet={!preview && value ? imageSrcSet(value) : undefined} sizes={shape === 'wide' ? '320px' : '160px'} alt=""
              width={value?.width} height={value?.height} className={busy ? 'is-busy' : undefined} />
          : <span className="image-field-empty" aria-hidden>{placeholder ?? <ImageIcon size={28} />}</span>}
      </div>
      <div className="image-field-body">
        <div className="row">
          <Button variant="secondary" disabled={busy || disabled} onClick={() => input.current?.click()} aria-describedby={hintId}>
            {value ? 'تغيير الصورة' : 'رفع صورة'}
          </Button>
          {busy && <Button variant="ghost" onClick={() => abort.current?.abort()}>إلغاء</Button>}
          {value && !busy && <Button variant="ghost" disabled={disabled} onClick={() => { setError(null); onChange(null); }}>إزالة الصورة</Button>}
        </div>
        <p className="muted small" id={hintId}>{hint ?? purpose === 'logo' ? 'يُفضّل PNG بخلفية شفافة، 48 بكسل على الأقل. يظهر في رأس الموقع وتذييله.' : 'JPG أو PNG أو WebP حتى 10 ميجابايت، 200 بكسل على الأقل. تُحفظ مع النموذج.'}</p>
        {busy && <progress max={1} value={progress} aria-label="جارٍ رفع" />}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
      <input ref={input} type="file" accept={ACCEPT_ATTR} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
    </fieldset>
  );
}
