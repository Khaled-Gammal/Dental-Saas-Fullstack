import { arName } from '@dental/ui/text';
import { navigate, useFlash } from '../../hooks';
import { categoryLabel, minutesLabel, t } from '../../i18n';
import { useCatalog, useServices } from '../../queries';
import { to } from '../../router';
import { priceParts } from '../../service-model';
import type { Service } from '../../types';
import { Alert, Badge, Button, Card, ErrorText, PageHeader } from '../../ui/components';
import { DataTable, type Column } from '../../ui/data-table';
import { CheckIcon, EditIcon, PlusIcon, TagIcon } from '../../ui/icons';
import { RouteLink } from '../../ui/page';
import { fmtNumber } from '../../util';
import { currencyLabel } from '../../money';
import { RowMenu } from '../../ui/row-menu';

export const priceLabel = (s: Pick<Service, 'price_minor' | 'price_max_minor'>) => {
  const p = priceParts(s, (n) => fmtNumber(n));
  return p ? `${p} ${currencyLabel()}` : t('onConsultation');
};

const serviceName = (s: Service) => arName(s.name_ar, s.name_en, s.catalog_code ?? '—');

/** The price list's columns: the price shown is the same label the website and the booking page use. */
const SERVICE_COLUMNS: Column<Service>[] = [
  {
    id: 'name', header: t('serviceColName'), sortValue: serviceName,
    cell: (s) => <strong className={s.is_active ? undefined : 'muted'}><bdi>{serviceName(s)}</bdi></strong>,
  },
  { id: 'duration', header: t('serviceColDuration'), numeric: true, hideOnMobile: true, sortValue: (s) => s.duration_minutes, cell: (s) => <>{fmtNumber(s.duration_minutes)} {minutesLabel(s.duration_minutes)}</> },
  {
    id: 'state', header: t('status'), hideOnMobile: true, sortValue: (s) => (s.is_active ? (s.show_on_website ? 0 : 1) : 2),
    cell: (s) => (!s.is_active ? <Badge dot>{t('inactive')}</Badge> : !s.show_on_website ? <Badge tone="warning" dot>{t('hidden')}</Badge> : <Badge tone="success" dot>{t('showOnWebsite')}</Badge>),
  },
  // ltr: "2,500–4,000" keeps its order inside Arabic text
  { id: 'price', header: t('serviceColPrice'), numeric: true, sortValue: (s) => s.price_minor, cell: (s) => <bdi dir="ltr" className="whitespace-nowrap font-semibold">{priceLabel(s)}</bdi> },
];

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

      {/* the clinic's own order (as on the website) until a header is clicked (redesign R4) */}
      <DataTable
        label={t('navServices')}
        rows={services.data}
        columns={SERVICE_COLUMNS}
        rowKey={(s) => s.id}
        isLoading={services.isLoading}
        isFetching={services.isFetching}
        error={services.isError ? services.error : undefined}
        onRetry={() => void services.refetch()}
        search={{ placeholder: t('serviceSearchHint'), text: (s) => [s.name_ar, s.name_en, s.catalog_code].filter(Boolean).join(' ') }}
        pageSize={50}
        actions={canWrite ? (s) => <RowMenu label={serviceName(s)} actions={[{ label: t('edit'), icon: <EditIcon size={16} />, route: to.edit('services', s.id) }]} /> : undefined}
        onRowClick={canWrite ? (s) => navigate(to.edit('services', s.id)) : undefined}
        empty={{ icon: <TagIcon size={28} />, title: t('noServices'), text: t('noServicesText'), action: addBtn || undefined }}
      />
    </>
  );
}
