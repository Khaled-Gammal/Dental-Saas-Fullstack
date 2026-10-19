import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { ApiError, uploadFile } from '../api';
import { ACCEPT_ATTR, uploadProblem } from '../gallery-model';
import { errorText, t } from '../i18n';
import type { MediaImage, MediaPurpose } from '../types';
import { Button } from '../ui/components';
import { CloseIcon, PlusIcon } from '../ui/icons';

type Item = { key: string; file: File; preview: string; progress: number; state: 'queued' | 'uploading' | 'done' | 'error'; error?: string };

/** Problem codes the API can return for an upload, mapped to dashboard text. */
const UPLOAD_ERRORS: Record<string, Parameters<typeof t>[0]> = {
  invalid_image: 'err_invalid_image', unsupported_image_type: 'err_unsupported_image_type', image_too_small: 'err_image_too_small',
  payload_too_large: 'err_payload_too_large', storage_limit_reached: 'err_storage_limit_reached', network: 'err_network', missing_permission: 'err_missing_permission',
};

/** Dashboard text for a failed upload (a logo's minimum size differs from a photo's). */
export function uploadErrorText(e: unknown, purpose: MediaPurpose = 'gallery'): string {
  const code = e instanceof ApiError ? e.code : 'error';
  if (code === 'image_too_small' && purpose === 'logo') return t('err_logo_too_small');
  return UPLOAD_ERRORS[code] ? t(UPLOAD_ERRORS[code]) : errorText(code, e instanceof ApiError ? e.status : undefined); // never the English detail (L10N-003)
}

/**
 * Reusable image uploader (gallery now; offers, stories and banners next): drop or pick images, see previews and
 * per-file progress, retry failures. Files are checked here for type and size, and decoded by the server.
 * `onUploaded` runs once per stored image, in the order they finish.
 */
export function ImageUploader({ multiple = true, onUploaded, disabled }: { multiple?: boolean; onUploaded: (img: MediaImage) => Promise<unknown> | void; disabled?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // previews are object URLs: release them when the list changes or the uploader goes away
  const urls = useRef(new Set<string>());
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  async function run(item: Item) {
    patch(item.key, { state: 'uploading', progress: 0, error: undefined });
    try {
      const img = await uploadFile<MediaImage>('/media?purpose=gallery', item.file, (p) => patch(item.key, { progress: p }));
      await onUploaded(img);
      patch(item.key, { state: 'done', progress: 1 });
    } catch (e) {
      patch(item.key, { state: 'error', error: uploadErrorText(e) });
    }
  }

  function add(files: FileList | File[]) {
    const list = Array.from(files).slice(0, multiple ? 20 : 1);
    const fresh: Item[] = list.map((file) => {
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      const problem = uploadProblem(file);
      return { key: `${file.name}-${file.size}-${Math.random()}`, file, preview, progress: 0, state: problem ? 'error' : 'queued', error: problem ? t(problem === 'type' ? 'err_unsupported_image_type' : 'err_payload_too_large') : undefined };
    });
    setItems((xs) => (multiple ? [...xs, ...fresh] : fresh));
    // one at a time keeps the order predictable and the connection free for the rest of the dashboard
    void (async () => { for (const it of fresh) if (it.state === 'queued') await run(it); })();
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); if (!disabled && e.dataTransfer.files.length) add(e.dataTransfer.files); };
  const remove = (key: string) => setItems((xs) => xs.filter((x) => { if (x.key === key) { URL.revokeObjectURL(x.preview); urls.current.delete(x.preview); } return x.key !== key; }));

  return (
    <div className="uploader">
      <div className={`dropzone${dragging ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`} onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <PlusIcon size={28} />
        <p><strong>{t('dropImages')}</strong></p>
        <p className="muted small" id={hintId}>{t('uploadHint')}</p>
        <Button variant="secondary" disabled={disabled} onClick={() => input.current?.click()} aria-describedby={hintId}>{t('chooseImages')}</Button>
        <input ref={input} type="file" accept={ACCEPT_ATTR} multiple={multiple} hidden onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ''; }} />
      </div>
      {items.length > 0 && (
        <ul className="upload-list" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className={`upload-item is-${it.state}`}>
              <img src={it.preview} alt="" />
              <div className="upload-meta">
                <span className="upload-name"><bdi>{it.file.name}</bdi></span>
                {it.state === 'error' ? <span className="field-error">{it.error}</span>
                  : it.state === 'done' ? <span className="ok-text">{t('uploaded')}</span>
                    : <progress max={1} value={it.progress} aria-label={`${t('uploading')} ${it.file.name}`} />}
              </div>
              {it.state === 'error' && !uploadProblem(it.file) && <Button variant="ghost" onClick={() => void run(it)}>{t('retry')}</Button>}
              {it.state !== 'uploading' && <button type="button" className="icon-btn" onClick={() => remove(it.key)} aria-label={t('remove')}><CloseIcon size={16} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
