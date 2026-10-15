import { describe, expect, it } from 'vitest';
import { groupsListUrl, listPlaceParams, readListPlace } from './groupListPlace';

const read = (search: string) => readListPlace(new URLSearchParams(search));

describe('the Alert Groups list place in its address', () => {
  it('reads page, rows per page, search and sort', () => {
    expect(read('?page=2&size=50&q=rasasi&sort=name.asc,updatedAt.desc')).toEqual({
      page: 2,
      pageSize: 50,
      search: 'rasasi',
      sort: [
        { field: 'name', dir: 'asc' },
        { field: 'updatedAt', dir: 'desc' },
      ],
    });
  });

  it('is the first page of 25, unsearched and unsorted, when the address says nothing', () => {
    expect(read('')).toEqual({ page: 1, pageSize: 25, search: '', sort: [] });
  });

  it('falls back to the defaults for values it cannot use', () => {
    expect(read('?page=abc&size=7&sort=bogus.asc,name.sideways')).toEqual({
      page: 1,
      pageSize: 25,
      search: '',
      sort: [],
    });
    expect(read('?page=0').page).toBe(1);
    expect(read('?page=2.5').page).toBe(1);
    expect(read('?sort=name.asc,name.desc').sort).toEqual([{ field: 'name', dir: 'asc' }]);
  });

  it('leaves the defaults out of the address', () => {
    expect(listPlaceParams({ page: 1, pageSize: 25, search: '', sort: [] }).toString()).toBe('');
  });

  it('writes what it reads', () => {
    const place = {
      page: 3,
      pageSize: 100,
      search: 'hawas ice',
      sort: [{ field: 'listingCount' as const, dir: 'desc' as const }],
    };
    expect(readListPlace(listPlaceParams(place))).toEqual(place);
  });
});

describe('the way back from the editor', () => {
  it('returns to the place the list handed over', () => {
    expect(groupsListUrl({ listSearch: '?page=2&q=rasasi' })).toBe(
      '/exclusives/groups?page=2&q=rasasi',
    );
  });

  it('returns to the plain list without one', () => {
    expect(groupsListUrl(null)).toBe('/exclusives/groups');
    expect(groupsListUrl(undefined)).toBe('/exclusives/groups');
    expect(groupsListUrl({ listSearch: '' })).toBe('/exclusives/groups');
    expect(groupsListUrl({ gid: 4 })).toBe('/exclusives/groups');
  });

  it('only ever adds a query to the list address', () => {
    expect(groupsListUrl({ listSearch: '//elsewhere.example' })).toBe('/exclusives/groups');
    expect(groupsListUrl({ listSearch: 42 })).toBe('/exclusives/groups');
  });
});
