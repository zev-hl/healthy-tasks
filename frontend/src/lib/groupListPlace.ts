import { EXCLUSIVES_GROUP_SORT_FIELDS, type ExclusivesGroupSortField } from '@healthy-tasks/shared';
import { PAGE_SIZES } from '../components/exclusives/ExcPager';
import type { SortEntry } from './multiSort';

/**
 * Where the Alert Groups list stands — page, rows per page, search and sort —
 * kept in its address (`/exclusives/groups?page=2&size=50&q=…&sort=name.asc`),
 * so leaving for the editor and coming back, a refresh or the browser's Back
 * all land on the same rows.
 */
export const GROUPS_PATH = '/exclusives/groups';

const DEFAULT_PAGE_SIZE = 25;

export interface GroupListPlace {
  page: number;
  pageSize: number;
  search: string;
  sort: SortEntry<ExclusivesGroupSortField>[];
}

function isSortField(value: string | undefined): value is ExclusivesGroupSortField {
  return (EXCLUSIVES_GROUP_SORT_FIELDS as readonly string[]).includes(value ?? '');
}

/** `name.asc,updatedAt.desc` → sort keys; anything unknown is dropped. */
function parseSort(value: string | null): SortEntry<ExclusivesGroupSortField>[] {
  const sort: SortEntry<ExclusivesGroupSortField>[] = [];
  for (const part of (value ?? '').split(',')) {
    const [field, dir] = part.split('.');
    if (!isSortField(field) || (dir !== 'asc' && dir !== 'desc')) continue;
    if (sort.some((s) => s.field === field)) continue;
    sort.push({ field, dir });
  }
  return sort;
}

/** The place in an address; a hand-edited or stale value falls back to the default. */
export function readListPlace(params: URLSearchParams): GroupListPlace {
  const page = Number(params.get('page'));
  const pageSize = Number(params.get('size'));
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    search: params.get('q') ?? '',
    sort: parseSort(params.get('sort')),
  };
}

/** The place as address parameters, leaving out whatever is at its default. */
export function listPlaceParams(place: GroupListPlace): URLSearchParams {
  const params = new URLSearchParams();
  if (place.page > 1) params.set('page', String(place.page));
  if (place.pageSize !== DEFAULT_PAGE_SIZE) params.set('size', String(place.pageSize));
  if (place.search) params.set('q', place.search);
  if (place.sort.length > 0) {
    params.set('sort', place.sort.map((s) => `${s.field}.${s.dir}`).join(','));
  }
  return params;
}

/** What the list hands the editor, so the editor can send people back. */
export interface GroupListLink {
  listSearch?: string;
}

/** The list address to go back to: the one the editor was opened from, if any. */
export function groupsListUrl(state: unknown): string {
  const search = (state as GroupListLink | null)?.listSearch;
  return typeof search === 'string' && search.startsWith('?')
    ? `${GROUPS_PATH}${search}`
    : GROUPS_PATH;
}
