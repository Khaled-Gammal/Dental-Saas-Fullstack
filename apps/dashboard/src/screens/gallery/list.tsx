import { useState } from 'react';
import { pickName } from '@dental/ui/text';
import { Choice } from '../../components/choice';
import { navigate, useDebounced, useFlash } from '../../hooks';
import { canReorder, moveId } from '../../gallery-model';
import { t, type Lang } from '../../i18n';
import { galleryApi, useBranches, useGallery, useGalleryMutation } from '../../queries';
import { to } from '../../router';
import type { GalleryItem } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, Input, PageHeader, Skeleton, Switch } from '../../ui/components';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { ChevronIcon, EditIcon, PlusIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { ScopeSelect, Thumb } from './shared';

/**
 * `#/gallery`: clinic-wide and branch photos. Filter by scope, status and text; publish, feature, reorder (one whole
 * scope at a time) and delete. Uploading happens on `#/gallery/new`, editing details on `#/gallery/:id/edit`.
 */
export function GalleryList({ lang, clinicId, query }: { lang: Lang; clinicId: string; query?: Record<string, string> }) {
  const flash = useFlash();
  const [scope, setScope] = useState(query?.scope ?? 'all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 250);
  const branches = useBranches(clinicId);
  const list = useGallery(clinicId, { scope, status, q: search });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const reorderable = canReorder({ scope, status, q: search, hasMore: !!list.hasNextPage });
  const branchName = (id: string | null) => {
    if (!id) return t('clinicWide', lang);
    const b = branches.data?.find((x) => x.id === id);
    return b ? pickName(lang, b.name_ar, b.name_en, b.slug) : '—';
  };

  const [error, setError] = useState<unknown>(null);
  const update = useGalleryMutation(clinicId, ({ id, body }: { id: string; body: Record<string, unknown> }) => galleryApi.update(id, body));
  const reorder = useGalleryMutation(clinicId, (ids: string[]) => galleryApi.reorder(scope === 'clinic' ? null : scope, ids));
  const remove = useGalleryMutation(clinicId, (id: string) => galleryApi.remove(id));
  const [deleting, setDeleting] = useState<GalleryItem | null>(null);
  const act = <V,>(m: { mutate: (v: V, o?: { onError?: (e: unknown) => void }) => void }, v: V) => { setError(null); m.mutate(v, { onError: setError }); };

  const add = <Button onClick={() => navigate({ page: 'gallery', action: 'new', ...(scope !== 'all' && { query: { scope } }) })}><PlusIcon size={18} />{t('addPhotos', lang)}</Button>;

  return (
    <>
      <PageHeader title={t('navGallery', lang)} sub={t('gallerySub', lang)} action={add} />
      {flash && <Alert tone="success">{flash}</Alert>}
      <div className="filter-bar">
        <ScopeSelect lang={lang} branches={branches.data ?? []} value={scope} onChange={setScope} withAll label={t('scope', lang)} />
        <Choice lang={lang} value={status} onChange={setStatus} label={t('status', lang)} className="h-10 min-w-36 bg-card"
          options={[{ value: 'all', label: t('allStatuses', lang) }, { value: 'published', label: t('publishedState', lang) }, { value: 'draft', label: t('draftState', lang) }]} />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchCaptions', lang)} aria-label={t('searchCaptions', lang)} />
      </div>
      {!reorderable && items.length > 1 && <p className="muted small">{t('reorderHint', lang)}</p>}
      <ErrorText error={error} />

      {list.isError ? <ErrorText error={list.error} onRetry={() => void list.refetch()} />
        : list.isLoading ? <div className="gallery-grid"><Skeleton h={220} count={6} /></div>
          : items.length === 0 ? <Card><EmptyState icon={<PlusIcon size={28} />} title={t(search || status !== 'all' ? 'noPhotoMatch' : 'noPhotos', lang)} text={t('noPhotosText', lang)} action={add} /></Card>
            : (
              <ul className="gallery-grid" aria-busy={list.isFetching || undefined}>
                {items.map((g, i) => (
                  <Card as="li" key={g.id} className={`gallery-card${g.is_published ? '' : ' is-draft'}`}>
                    <div className="gallery-thumb">
                      <Thumb img={g.image} alt={g.alt_ar ?? g.alt_en ?? g.caption_ar ?? ''} />
                      <span className="gallery-badges">
                        <Badge tone={g.is_published ? 'success' : 'neutral'}>{t(g.is_published ? 'publishedState' : 'draftState', lang)}</Badge>
                        {g.is_featured && <Badge tone="primary">{t('featured', lang)}</Badge>}
                      </span>
                    </div>
                    <div className="gallery-body">
                      <strong className="gallery-caption"><bdi>{g.caption_ar ?? g.caption_en ?? g.alt_ar ?? t('noCaption', lang)}</bdi></strong>
                      <span className="muted small">{branchName(g.branch_id)}</span>
                      <div className="gallery-switches">
                        <Switch checked={g.is_published} label={t('publishedState', lang)} onChange={(v) => act(update, { id: g.id, body: { isPublished: v } })} />
                        <Switch checked={g.is_featured} label={t('featured', lang)} onChange={(v) => act(update, { id: g.id, body: { isFeatured: v } })} />
                      </div>
                      <div className="gallery-actions">
                        {reorderable && (
                          <>
                            <button type="button" className="icon-btn" disabled={i === 0 || reorder.isPending} onClick={() => act(reorder, moveId(items.map((x) => x.id), g.id, -1))} aria-label={t('moveEarlier', lang)}><ChevronIcon size={16} className="rot-up" /></button>
                            <button type="button" className="icon-btn" disabled={i === items.length - 1 || reorder.isPending} onClick={() => act(reorder, moveId(items.map((x) => x.id), g.id, 1))} aria-label={t('moveLater', lang)}><ChevronIcon size={16} className="rot-down" /></button>
                          </>
                        )}
                        <RouteLink route={to.edit('gallery', g.id)}><EditIcon size={16} />{t('edit', lang)}</RouteLink>
                        <Button variant="ghost" onClick={() => setDeleting(g)}>{t('remove', lang)}</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </ul>
            )}
      {list.hasNextPage && <div className="row-center mt"><Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t('loadMore', lang)}</Button></div>}

      <ConfirmDialog open={!!deleting} title={t('deletePhoto', lang)} confirmLabel={t('remove', lang)} danger
        onConfirm={() => { if (deleting) act(remove, deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)}>
        {t('deletePhotoText', lang)}
      </ConfirmDialog>
    </>
  );
}
