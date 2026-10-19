import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MultiSelect } from './MultiSelect';

const OPTIONS = [
  { value: '__not_set__', label: '(not set)' },
  { value: '4', label: 'Versure Exclusives' },
  { value: '7', label: 'Sports Nutrition' },
];
const labels = () => screen.queryAllByRole('checkbox').map((c) => c.parentElement?.textContent);

describe('MultiSelect', () => {
  it('has no search box unless asked for one', () => {
    render(<MultiSelect options={OPTIONS} selected={[]} onChange={vi.fn()} />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('narrows the list as you type, and keeps hidden ticks', () => {
    const onChange = vi.fn();
    render(<MultiSelect searchable options={OPTIONS} selected={['7']} onChange={onChange} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search options' }), {
      target: { value: 'VERS' },
    });
    expect(labels()).toEqual(['Versure Exclusives']);
    // No "Select all" while searching: it would be unclear what "all" means.
    expect(screen.queryByRole('button', { name: /select all/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(['4', '7']);
  });

  it('says so when nothing matches', () => {
    render(<MultiSelect searchable options={OPTIONS} selected={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('selects every option, "(not set)" included, with Select all', () => {
    const onChange = vi.fn();
    render(<MultiSelect searchable options={OPTIONS} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(onChange).toHaveBeenCalledWith(['__not_set__', '4', '7']);
  });
});
