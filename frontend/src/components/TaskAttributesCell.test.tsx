import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TaskAttributesCell } from './TaskAttributesCell';

const both = {
  alertGroup: { id: 4, name: 'Versure Exclusives' },
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
});
