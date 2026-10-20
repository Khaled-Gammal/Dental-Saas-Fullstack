import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react';
import { t } from '../i18n';
import { paginate, searchRows, sortRows, nextSort, type SortState, type SortValue } from '../table-model';
import { fmtNumber } from '../util';
import { Button, EmptyState, ErrorText } from './components';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** One column: how a cell looks, and (optionally) the value it sorts by. Domain columns live with their screen. */
export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** makes the column sortable */
  sortValue?: (row: T) => SortValue;
  /** numbers and money: aligned to the end, tabular figures */
  numeric?: boolean;
  /** hidden on narrow screens (the row still shows its key columns) */
  hideOnMobile?: boolean;
  className?: string;
}

/**
 * The dashboard's table (redesign R2) on shadcn/ui's Table: typed columns, sorting, search, paging, loading, empty and
 * error states, a row action column. Every feature is optional — a short list passes only its columns. It works on the
 * rows it is given; a list that can be large should be filtered and paged by the API, and given here one page at a time.
 * Wide tables scroll sideways inside their card on small screens, never the page.
 */
export function DataTable<T>({
  rows, columns, rowKey, isLoading, error, onRetry, empty, search, pageSize, defaultSort, actions, onRowClick, toolbar, label,
}: {
  rows: readonly T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: { icon: ReactNode; title: string; text: string; action?: ReactNode };
  /** a search box over the rows: what text each row is found by */
  search?: { placeholder: string; text: (row: T) => string };
  /** rows per page; no paging when absent */
  pageSize?: number;
  defaultSort?: SortState;
  /** the actions at the end of each row (edit, view…); render only what the member may do */
  actions?: (row: T) => ReactNode;
  /** a whole-row click (the row also needs a real link in one of its cells, for the keyboard) */
  onRowClick?: (row: T) => void;
  /** filters or buttons beside the search box */
  toolbar?: ReactNode;
  /** what the table lists, for screen readers */
  label: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const [page, setPage] = useState(1);

  const shown = useMemo(() => {
    let r = rows ?? [];
    if (search && query) r = searchRows(r, query, search.text);
    if (sort) r = sortRows(r, columns.find((c) => c.id === sort.id)?.sortValue, sort.dir);
    return r;
  }, [rows, search, query, sort, columns]);
  const view = pageSize ? paginate(shown, page, pageSize) : { rows: shown, page: 1, pages: 1, total: shown.length, from: 1, to: shown.length };
  const cols = columns.length + (actions ? 1 : 0);
  const mobileHide = (c: Column<T>) => (c.hideOnMobile ? 'hidden md:table-cell' : '');

  return (
    <div className="data-table">
      {(search || toolbar) && (
        <div className="data-table-toolbar">
          {search && (
            <label className="data-table-search">
              <Search aria-hidden className="size-4 text-muted-foreground" />
              <input className="input" type="search" value={query} placeholder={search.placeholder} aria-label={search.placeholder}
                onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
            </label>
          )}
          {toolbar}
        </div>
      )}
      {error ? <ErrorText error={error} onRetry={onRetry} /> : (
        <Table aria-label={label} aria-busy={isLoading || undefined}>
          <TableHeader className="bg-surface">
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => {
                const dir = sort?.id === c.id ? sort.dir : null;
                return (
                  <TableHead key={c.id} className={`h-10 px-3 text-start text-xs font-semibold text-muted-foreground ${c.numeric ? 'text-end' : ''} ${mobileHide(c)} ${c.className ?? ''}`}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : c.sortValue ? 'none' : undefined}>
                    {c.sortValue ? (
                      <button type="button" className="data-table-sort" onClick={() => { setSort(nextSort(sort, c.id)); setPage(1); }}>
                        {c.header}
                        {dir === 'asc' ? <ArrowUp className="size-3.5" /> : dir === 'desc' ? <ArrowDown className="size-3.5" /> : <ChevronsUpDown className="size-3.5 opacity-50" />}
                      </button>
                    ) : c.header}
                  </TableHead>
                );
              })}
              {actions && <TableHead className="w-0 px-3"><span className="sr-only">{t('actions')}</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !rows ? (
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell colSpan={cols} className="px-3 py-3"><div className="skeleton" style={{ height: 20 }} aria-hidden /></TableCell>
                </TableRow>
              ))
            ) : !view.rows.length ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={cols} className="whitespace-normal p-0">
                  {query ? <p className="data-table-none">{t('noSearchResults')}</p> : <EmptyState {...empty} />}
                </TableCell>
              </TableRow>
            ) : view.rows.map((r) => (
              <TableRow key={rowKey(r)} className={onRowClick ? 'cursor-pointer' : undefined}
                onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest('a, button, input, [role="menuitem"]')) onRowClick(r); } : undefined}>
                {columns.map((c) => (
                  <TableCell key={c.id} className={`px-3 py-3 ${c.numeric ? 'text-end tabular-nums' : 'whitespace-normal'} ${mobileHide(c)} ${c.className ?? ''}`}>{c.cell(r)}</TableCell>
                ))}
                {actions && <TableCell className="px-3 py-2 text-end">{actions(r)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {pageSize && view.pages > 1 && (
        <nav className="data-table-pager" aria-label={t('pagination')}>
          <Button variant="secondary" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>{t('previous')}</Button>
          <span className="muted small">
            {t('pageOf').replace('{page}', fmtNumber(view.page)).replace('{pages}', fmtNumber(view.pages))}
            {' · '}{t('rowsRange').replace('{from}', fmtNumber(view.from)).replace('{to}', fmtNumber(view.to)).replace('{total}', fmtNumber(view.total))}
          </span>
          <Button variant="secondary" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>{t('next')}</Button>
        </nav>
      )}
    </div>
  );
}
