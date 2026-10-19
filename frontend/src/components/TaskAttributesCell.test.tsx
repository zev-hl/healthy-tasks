import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TaskAttributeKey } from '@healthy-tasks/shared';
import { TaskAttributesCell } from './TaskAttributesCell';
import type { taskAttributeList } from '../lib/taskAttributes';

// Only two attributes exist today; a longer list stands in for later ones.
const fake = vi.hoisted(() => ({ list: null as ReturnType<typeof taskAttributeList> | null }));
vi.mock('../lib/taskAttributes', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/taskAttributes')>();
  return {
    ...real,
    taskAttributeList: (task: Parameters<typeof real.taskAttributeList>[0]) =>
      fake.list ?? real.taskAttributeList(task),
  };
});
afterEach(() => {
  fake.list = null;
});

/** An attribute list with these values (null = not set). */
function attributes(...values: (string | null)[]) {
  return values.map((value, i) => ({
    key: `attr${i + 1}` as TaskAttributeKey,
    label: `Attribute ${i + 1}`,
    value,
  }));
}

const both = {
  alertGroup: { id: 4, name: 'Versure Exclusives', isActive: true },
  alertType: 'BuyBoxLost' as const,
};

describe('TaskAttributesCell', () => {
  it('shows the values that are set as small capsules', () => {
    render(<TaskAttributesCell task={both} />);
    expect(screen.getByText('Versure Exclusives')).toHaveAttribute(
      'title',
      'Alert Group: Versure Exclusives',
    );
    expect(screen.getByText('Buy Box Lost')).toHaveAttribute('title', 'Alert Type: Buy Box Lost');
  });

  it('with one or two set, the button is a plain "+", with no number', () => {
    const { unmount } = render(<TaskAttributesCell task={both} />);
    const two = screen.getByRole('button', { name: 'Show all attributes' });
    expect(two).toHaveAttribute('data-sign', 'plus');
    expect(two.textContent).toBe('');
    unmount();

    render(<TaskAttributesCell task={{ alertGroup: null, alertType: 'PriceChanged' }} />);
    const one = screen.getByRole('button', { name: 'Show all attributes' });
    expect(one).toHaveAttribute('data-sign', 'plus');
    expect(one.textContent).toBe('');
  });

  it('with more than two set, shows two capsules and how many are not shown', () => {
    fake.list = attributes('One', null, 'Two', 'Three');
    const { unmount } = render(<TaskAttributesCell task={both} />);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.queryByText('Three')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all attributes (1 more)' })).toHaveTextContent(
      /^\+1$/,
    );
    unmount();

    fake.list = attributes('One', 'Two', 'Three', 'Four', 'Five');
    render(<TaskAttributesCell task={both} />);
    const more = screen.getByRole('button', { name: 'Show all attributes (3 more)' });
    expect(more).toHaveTextContent(/^\+3$/);

    // The number opens the same window, with every attribute in it, and
    // turns into the "−" while it is open.
    fireEvent.click(more);
    const pop = screen.getByRole('dialog', { name: 'Attributes' });
    for (const value of ['One', 'Two', 'Three', 'Four', 'Five']) {
      expect(within(pop).getByText(value)).toBeInTheDocument();
    }
    expect(more).toHaveAttribute('data-sign', 'minus');
    expect(more).toHaveAccessibleName('Hide attributes');
    expect(more).not.toHaveTextContent('+3');

    fireEvent.click(more);
    expect(more).toHaveTextContent(/^\+3$/);
  });

  it('shows a dash, and no "+", when nothing is set', () => {
    render(<TaskAttributesCell task={{ alertGroup: null, alertType: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all attributes' })).not.toBeInTheDocument();
  });

  it('the "+" opens a window with every attribute, unset ones included', () => {
    render(<TaskAttributesCell task={{ alertGroup: null, alertType: 'PriceChanged' }} />);
    expect(screen.queryByText('Alert Group')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all attributes' }));
    const pop = screen.getByRole('dialog', { name: 'Attributes' });
    expect(within(pop).getByText('Alert Group')).toBeInTheDocument();
    expect(within(pop).getByText('—')).toBeInTheDocument();
    expect(within(pop).getByText('Alert Type')).toBeInTheDocument();
    expect(within(pop).getByText('Price Changed')).toBeInTheDocument();
  });

  it('opening and using the window never opens the row', () => {
    const openRow = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={openRow}>
            <td>
              <TaskAttributesCell task={both} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show all attributes' }));
    fireEvent.click(screen.getByRole('dialog', { name: 'Attributes' }));
    expect(openRow).not.toHaveBeenCalled();
  });

  it('closes with Escape, a click elsewhere, or the "+" again', () => {
    render(<TaskAttributesCell task={both} />);
    const plus = screen.getByRole('button', { name: 'Show all attributes' });

    fireEvent.click(plus);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(plus);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(plus);
    expect(plus).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(plus);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a plus when closed and a minus while open', () => {
    render(<TaskAttributesCell task={both} />);
    const button = screen.getByRole('button', { name: 'Show all attributes' });
    // The sign is drawn: the plus is the same bar as the minus plus an upright.
    expect(button).toHaveAttribute('data-sign', 'plus');
    expect(button.querySelectorAll('line')).toHaveLength(2);

    fireEvent.click(button);
    expect(button).toHaveAttribute('data-sign', 'minus');
    expect(button.querySelectorAll('line')).toHaveLength(1);
    expect(button).toHaveAccessibleName('Hide attributes');

    fireEvent.click(button);
    expect(button).toHaveAttribute('data-sign', 'plus');
    expect(button).toHaveAccessibleName('Show all attributes');
  });
});
