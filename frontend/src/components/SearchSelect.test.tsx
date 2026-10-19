import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SearchSelect } from './SearchSelect';

const OPTIONS = [
  { value: 'BuyBoxLost', label: 'Buy Box Lost' },
  { value: 'BuyBoxWon', label: 'Buy Box Won' },
  { value: 'PriceChanged', label: 'Price Changed' },
];

const setup = (value: string | null = null) => {
  const onChange = vi.fn();
  render(<SearchSelect label="Alert Type" options={OPTIONS} value={value} onChange={onChange} />);
  return onChange;
};
const open = () => fireEvent.click(screen.getByRole('button', { name: /Alert Type/ }));
const search = () => screen.getByRole('combobox', { name: 'Search Alert Type' });
const shownOptions = () =>
  within(screen.getByRole('listbox'))
    .queryAllByRole('option')
    .map((o) => o.textContent);

describe('SearchSelect', () => {
  it('shows the chosen value, or that there is none', () => {
    setup('PriceChanged');
    expect(screen.getByRole('button', { name: 'Alert Type: Price Changed' })).toBeInTheDocument();
  });

  it('opens with a search box and every option, clearing first', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Alert Type: — None —' })).toBeInTheDocument();
    open();
    expect(search()).toHaveFocus();
    expect(shownOptions()).toEqual(['— None —', 'Buy Box Lost', 'Buy Box Won', 'Price Changed']);
  });

  it('narrows the list to what was typed, in any case', () => {
    setup();
    open();
    fireEvent.change(search(), { target: { value: 'BUY' } });
    expect(shownOptions()).toEqual(['Buy Box Lost', 'Buy Box Won']);
    fireEvent.change(search(), { target: { value: 'zzz' } });
    expect(shownOptions()).toEqual([]);
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('picks with the arrow keys and Enter', () => {
    const onChange = setup();
    open();
    fireEvent.change(search(), { target: { value: 'buy' } });
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('BuyBoxWon');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('picks with a click, and the first option clears', () => {
    const onChange = setup('PriceChanged');
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Buy Box Lost' }));
    expect(onChange).toHaveBeenLastCalledWith('BuyBoxLost');
    open();
    fireEvent.click(screen.getByRole('option', { name: '— None —' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('marks the current choice, and does not report choosing it again', () => {
    const onChange = setup('PriceChanged');
    open();
    const current = screen.getByRole('option', { name: 'Price Changed' });
    expect(current).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(current);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Escape without changing anything', () => {
    const onChange = setup();
    open();
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
