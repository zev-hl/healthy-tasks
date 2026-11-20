import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Select, type SelectOption } from './Select';

const FRUIT: SelectOption<string>[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'damson', label: 'Damson' },
];

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [v, setV] = useState<string>('apple');
  return (
    <Select
      label="Fruit"
      value={v}
      options={FRUIT}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
    />
  );
}

const trigger = () => screen.getByRole('button', { name: /^Fruit:/ });

describe('Harbor Select from the keyboard', () => {
  // jsdom has no scrollIntoView; the menu calls it to keep the highlight in view.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('moves focus into the list as it opens, so ↓ and Enter pick', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    trigger().focus();

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    const list = await screen.findByRole('listbox', { name: 'Fruit' });
    expect(document.activeElement).toBe(list);
    // Never hidden in a way that refuses focus while it is being placed.
    expect(list.closest<HTMLElement>('.hb-pop')!.style.visibility).not.toBe('hidden');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(within(list).getByRole('option', { name: 'Cherry' })).toHaveClass('hi');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    fireEvent.keyDown(list, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('banana');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger()).toHaveAccessibleName('Fruit: Banana');
    expect(document.activeElement).toBe(trigger());
  });

  it('jumps by typing, and Esc closes without picking', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    const list = await screen.findByRole('listbox', { name: 'Fruit' });
    expect(document.activeElement).toBe(list);

    fireEvent.keyDown(list, { key: 'd' });
    expect(within(list).getByRole('option', { name: 'Damson' })).toHaveClass('hi');

    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it('puts focus in the search box for a long list, where ↓ and Enter still pick', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      value: `p${i}`,
      label: `Person ${i}`,
    }));
    const onChange = vi.fn();
    render(<Select label="Owner" value={null} options={many} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Owner:/ }), { key: 'ArrowDown' });
    const search = await screen.findByRole('textbox', { name: 'Search Owner' });
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: '1' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    // "1" matches Person 1, 10 and 11; ↓ moves to the second.
    expect(onChange).toHaveBeenCalledWith('p10');
  });
});
