import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
