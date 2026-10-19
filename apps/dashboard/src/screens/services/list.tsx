import { arName } from '@dental/ui/text';
import { navigate, useFlash } from '../../hooks';
import { categoryLabel, minutesLabel, t } from '../../i18n';
import { useCatalog, useServices } from '../../queries';
import { to } from '../../router';
import { priceParts } from '../../service-model';
import type { Service } from '../../types';
import { Alert, Badge, Button, Card, EmptyState, ErrorText, PageHeader, Skeleton } from '../../ui/components';
import { CheckIcon, EditIcon, PlusIcon, TagIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { currencyLabel } from '../../money';

export const priceLabel = (s: Pick<Service, 'price_minor' | 'price_max_minor'>) => {
  const p = priceParts(s, (n) => fmtNumber(n));
  return p ? `${p} ${currencyLabel()}` : t('onConsultation');
};

/** `#/services` — the price list plus the catalogue to add from. */
export function ServicesList({ clinicId, canWrite }: { clinicId: string; canWrite: boolean }) {
  const flash = useFlash();
  const services = useServices(clinicId);
  const catalog = useCatalog(clinicId);
  const count = services.data?.length ?? 0;
  const usedCodes = new Set(services.data?.map((s) => s.catalog_code).filter(Boolean));
  const addBtn = canWrite && <Button onClick={() => navigate(to.create('services'))}><PlusIcon size={18} />{t('addService')}</Button>;

  return (
    <>
      <PageHeader title={t('navServices')} sub={t('servicesSub')} action={count > 0 ? addBtn : undefined} />
      {flash && <Alert tone="success">{flash}</Alert>}

      {canWrite && catalog.isError && <ErrorText error={catalog.error} onRetry={() => void catalog.refetch()} />}
      {/* the catalogue: one click opens the create page with the service's names and usual duration filled in */}
      {canWrite && catalog.data && catalog.data.some((c) => !usedCodes.has(c.code)) && (
        <Card className="catalog">
          <h2>{t('fromCatalog')}</h2>
          <p className="muted small">{t('pickService')}</p>
          <ul className="catalog-list">
            {catalog.data.map((c) => {
              const added = usedCodes.has(c.code);
              const inner = (
                <>
                  <span className="catalog-name"><bdi>{arName(c.name_ar, c.name_en, c.code)}</bdi></span>
                  <span className="muted small">{categoryLabel(c.category)} · {fmtNumber(c.default_duration_minutes)} {minutesLabel(c.default_duration_minutes)}</span>
                  {added && <span className="catalog-added"><CheckIcon size={14} />{t('alreadyAdded')}</span>}
                </>
              );
              return (
                <li key={c.code}>
                  {added ? <span className="catalog-item is-added">{inner}</span> : <RouteLink route={to.create('services', { catalog: c.code })} className="catalog-item">{inner}</RouteLink>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {services.isError ? (
        <ErrorText error={services.error} onRetry={() => void services.refetch()} />
      ) : services.isLoading ? (
        <div className="cards"><Skeleton h={96} count={3} /></div>
      ) : count === 0 ? (
        <Card><EmptyState icon={<TagIcon size={28} />} title={t('noServices')} text={t('noServicesText')} action={addBtn} /></Card>
      ) : (
        <ul className="service-list" aria-busy={services.isFetching || undefined}>
          {services.data?.map((s) => (
            <Card as="li" key={s.id} className={`service${s.is_active ? '' : ' is-inactive'}`}>
              <div className="service-main">
                <strong><bdi>{arName(s.name_ar, s.name_en, s.catalog_code ?? '—')}</bdi></strong>
                <span className="muted small">
                  {fmtNumber(s.duration_minutes)} {minutesLabel(s.duration_minutes)}
                  {!s.is_active ? <> · <Badge>{t('inactive')}</Badge></> : !s.show_on_website ? <> · <Badge tone="warning">{t('hidden')}</Badge></> : null}
                </span>
              </div>
              <span className="service-price"><bdi dir="ltr">{priceLabel(s)}</bdi></span>{/* ltr: "2,500–4,000" keeps its order inside Arabic text */}
              {canWrite && <RouteLink route={to.edit('services', s.id)}><EditIcon size={16} />{t('edit')}</RouteLink>}
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}
