import { useState } from 'react';
import { ImageUploader } from '../../components/image-uploader';
import { navigate } from '../../hooks';
import { t, type Lang } from '../../i18n';
import { galleryApi, useBranches, useGalleryMutation } from '../../queries';
import { to } from '../../router';
import type { GalleryItem } from '../../types';
import { Alert, Button, Card, Field } from '../../ui/components';
import { Breadcrumbs, RouteLink } from '../../ui/page';
import { ScopeSelect, Thumb } from './shared';

/**
 * `#/gallery/new?scope=…`: upload photos into one gallery (clinic-wide or a branch). Each stored image becomes a
 * draft photo at once; the user then describes and publishes it (alt text is required to publish).
 */
export function GalleryUpload({ lang, clinicId, query }: { lang: Lang; clinicId: string; query?: Record<string, string> }) {
  const branches = useBranches(clinicId);
  const [scope, setScope] = useState(query?.scope && query.scope !== 'all' ? query.scope : 'clinic');
  const [added, setAdded] = useState<GalleryItem[]>([]);
  const create = useGalleryMutation(clinicId, (fileId: string) => galleryApi.create({ fileId, branchId: scope === 'clinic' ? null : scope }));

  return (
    <>
      <Breadcrumbs items={[{ label: t('navGallery', lang), route: to.list('gallery') }, { label: t('addPhotos', lang) }]} />
      <div className="page-head"><div><h1>{t('addPhotos', lang)}</h1><p>{t('uploadPageSub', lang)}</p></div></div>
      <div className="stack mt">
        <Card>
          <Field label={t('uploadInto', lang)} hint={t('uploadIntoHint', lang)}>
            {(a) => <ScopeSelect id={a.id} lang={lang} branches={branches.data ?? []} value={scope} onChange={setScope} withAll={false} />}
          </Field>
        </Card>
        <Card>
          <ImageUploader lang={lang} onUploaded={async (img) => { const item = await create.mutateAsync(img.id); setAdded((xs) => [...xs, item]); }} />
        </Card>
        {added.length > 0 && (
          <Card>
            <Alert tone="info">{t('uploadedAsDrafts', lang)}</Alert>
            <ul className="gallery-grid mt">
              {added.map((g) => (
                <li key={g.id} className="gallery-card">
                  <div className="gallery-thumb"><Thumb img={g.image} alt="" /></div>
                  <div className="gallery-body"><RouteLink route={to.edit('gallery', g.id)}>{t('describeAndPublish', lang)}</RouteLink></div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="row-end"><Button variant="secondary" onClick={() => navigate({ page: 'gallery', ...(scope && { query: { scope } }) })}>{t('backToGallery', lang)}</Button></div>
      </div>
    </>
  );
}
