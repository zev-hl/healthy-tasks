import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { StrictMode } from 'react';
import { RichText } from './RichText';
import { RichTextEditor } from './RichTextEditor';

/** HLAI-112: the one link rich text may hold, to the Alert Log. */

const LINK = '/exclusives/log?from=2026-10-19T12%3A30%3A00.000Z&type=ListingSuppressed&group=2';
const HTML =
  `<ol><li><p>B0ABC12345: Wasif - CA - Listing Suppressed - Oct 19, 2026, 2:15 PM</p></li></ol>` +
  `<p><a href="${LINK}">View these alerts in the Alert Log</a></p>` +
  `<p>Also <a href="https://example.com">elsewhere</a>.</p>`;

function WhereAmI() {
  const { pathname, search } = useLocation();
  return <output aria-label="address">{pathname + search}</output>;
}

describe('RichText', () => {
  it('shows an Alert Log link, and no other', () => {
    render(<RichText html={HTML} />);
    expect(
      screen.getByRole('link', { name: 'View these alerts in the Alert Log' }),
    ).toHaveAttribute('href', LINK);
    expect(screen.queryByRole('link', { name: 'elsewhere' })).toBeNull();
    expect(screen.getByText('elsewhere')).toBeInTheDocument();
  });

  it('opens the Alert Log in the app when the link is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/tasks/44']}>
        <Routes>
          <Route path="/tasks/44" element={<RichText html={HTML} />} />
          <Route path="/exclusives/log" element={<WhereAmI />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'View these alerts in the Alert Log' }));
    expect(screen.getByLabelText('address')).toHaveTextContent(LINK);
  });
});

describe('RichTextEditor', () => {
  it('keeps an Alert Log link while editing, and drops any other', () => {
    render(<RichTextEditor value={HTML} onChange={() => {}} ariaLabel="Description" />);
    const links = [...document.querySelectorAll('.rte-content a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([LINK]);
    expect(links[0]).not.toHaveAttribute('target');
    // The other link's words stay, as plain text.
    expect(screen.getByText('Also elsewhere.')).toBeInTheDocument();
  });
});

// --- Tables (for anyone; a Daily alert task's alerts come as one) ---------------

const TABLE =
  '<table><tbody>' +
  '<tr><th><p>No.</p></th><th><p>ASIN</p></th></tr>' +
  '<tr><td><p>1</p></td><td><p>B0ABC12345</p></td></tr>' +
  '</tbody></table>';

describe('tables', () => {
  it('are shown in a description, header row and all', () => {
    render(<RichText html={TABLE} />);
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('th')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: 'B0ABC12345' })).toBeInTheDocument();
  });

  it('can be inserted from the toolbar, and grown and shrunk inside', () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="<p>Notes</p>" onChange={onChange} ariaLabel="Description" />);
    const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const item = (name: string) => screen.getByRole('menuitem', { name });

    // Outside a table only inserting makes sense.
    openMenu();
    expect(item('Insert table')).toBeEnabled();
    expect(item('Add row below')).toBeDisabled();
    fireEvent.click(item('Insert table'));
    const html = () => onChange.mock.calls.at(-1)![0] as string;
    expect(html()).toMatch(/<table/);
    expect(html().match(/<th\b/g)).toHaveLength(3); // a header row of three
    expect(html().match(/<tr\b/g)).toHaveLength(3);

    // The cursor is in the new table: now it can be changed.
    openMenu();
    expect(item('Insert table')).toBeDisabled();
    fireEvent.click(item('Add row below'));
    expect(html().match(/<tr\b/g)).toHaveLength(4);
    openMenu();
    fireEvent.click(item('Add column right'));
    expect(html().match(/<th\b/g)).toHaveLength(4);
    openMenu();
    fireEvent.click(item('Delete table'));
    expect(html()).not.toMatch(/<table/);
  });
});

// --- Long cells in a table's last column fold to 3 lines -------------------------

describe('long last-column cells', () => {
  const LONG =
    'TEST — Title changed from "a very long old title" to "a very long new title". '.repeat(4);
  const FOLDABLE =
    '<table><tbody>' +
    '<tr><th><p>No.</p></th><th><p>Details</p></th></tr>' +
    `<tr><td><p>1</p></td><td><p>${LONG}</p></td></tr>` +
    '<tr><td><p>2</p></td><td><p>Short one</p></td></tr>' +
    '</tbody></table>';

  // jsdom lays nothing out: a folded box is "taller than it shows" when it holds
  // more than 100 characters.
  const originals = {
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  };
  function fakeLayout() {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return (this.textContent ?? '').length > 100 ? 200 : 40;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 60;
      },
    });
  }
  afterEach(() => {
    for (const [name, d] of Object.entries(originals)) {
      if (d) Object.defineProperty(HTMLElement.prototype, name, d);
    }
  });

  it('shows an arrow on a long last-column cell only, which opens it and folds it back', () => {
    fakeLayout();
    render(<RichText html={FOLDABLE} />);
    const toggles = screen.getAllByRole('button', { name: 'Show all' });
    expect(toggles).toHaveLength(1); // the short cell and the No. column get none
    const cell = toggles[0]!.closest('td')!;
    expect(cell).toHaveTextContent(/Title changed/);
    expect(cell).not.toHaveClass('is-open');

    fireEvent.click(toggles[0]!);
    expect(cell).toHaveClass('is-open');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(cell).not.toHaveClass('is-open');
    expect(screen.getByRole('button', { name: 'Show all' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('gives a cell one arrow, even when React sets it up twice (Strict Mode)', () => {
    fakeLayout();
    render(
      <StrictMode>
        <RichText html={FOLDABLE} />
      </StrictMode>,
    );
    expect(document.querySelectorAll('.rt-fold-toggle')).toHaveLength(1);
    expect(document.querySelectorAll('.rt-fold-text .rt-fold-text')).toHaveLength(0);
  });

  it('leaves the editor showing every cell in full', () => {
    fakeLayout();
    render(<RichTextEditor value={FOLDABLE} onChange={() => {}} ariaLabel="Description" />);
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(document.querySelector('.rte-content .rt-fold')).toBeNull();
  });
});
