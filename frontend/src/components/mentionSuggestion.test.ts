import { describe, expect, it } from 'vitest';
import type { TaskUserRef } from '@healthy-tasks/shared';
import { rankMentionUsers } from './mentionSuggestion';

const user = (id: string, firstName: string, lastName: string, email: string): TaskUserRef => ({
  id,
  firstName,
  lastName,
  email,
  title: null,
});

describe('@mention ranking', () => {
  const admin = user('a', 'System', 'Administrator', 'admin@preview.local');
  const mike = user('m', 'Mike', 'Member', 'mike.member@preview.local');

  it('puts a name that starts with the query above an email that only contains it', () => {
    expect(rankMentionUsers([admin, mike], 'Mi').map((u) => u.id)).toEqual(['m', 'a']);
  });

  it('ranks first/last name, full name, name contains, email starts, email contains', () => {
    const tom = user('t', 'Tom', 'Kimi', 'tom@x.io'); // name contains "mi"
    const mira = user('e', '', '', 'mira@x.io'); // email starts with "mi"
    const jamie = user('j', 'Jamie', 'Stone', 'js@x.io'); // name contains "mi"
    const ann = user('s', 'Ann', 'Mills', 'ann@x.io'); // last name starts with "mi"
    const ops = user('x', '', '', 'admin@x.io'); // email contains "mi"
    const ranked = rankMentionUsers([ops, tom, mira, jamie, ann, mike], 'mi');
    expect(ranked.map((u) => u.id)).toEqual(['s', 'm', 't', 'j', 'e', 'x']);
  });

  it('matches a full name typed with its space', () => {
    const jo = user('o', 'Jo', 'Mike', 'jo@x.io'); // no match for "mike m": stays last
    const mike2 = user('k', 'Mike', 'Mason', 'mm@x.io'); // full name starts with it
    expect(rankMentionUsers([jo, mike2], 'mike m').map((u) => u.id)).toEqual(['k', 'o']);
  });

  it('keeps the incoming order when there is no query', () => {
    expect(rankMentionUsers([admin, mike], '  ').map((u) => u.id)).toEqual(['a', 'm']);
  });
});
