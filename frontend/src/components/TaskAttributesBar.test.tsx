import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TaskAttributesBar } from './TaskAttributesBar';

describe('TaskAttributesBar', () => {
  it('lists each attribute with its value', () => {
    render(
      <TaskAttributesBar
        task={{
          alertGroup: { id: 4, name: 'Versure Exclusives', isActive: true },
          alertType: 'BuyBoxLost',
        }}
        canEdit
        onEdit={vi.fn()}
      />,
    );
    const bar = screen.getByRole('group', { name: 'Attributes' });
    expect(within(bar).getByText('Alert Group')).toBeInTheDocument();
    expect(within(bar).getByText('Versure Exclusives')).toBeInTheDocument();
    expect(within(bar).getByText('Alert Type')).toBeInTheDocument();
    expect(within(bar).getByText('Buy Box Lost')).toBeInTheDocument();
  });

  it('marks an inactive group in red before its name, and only an inactive one', () => {
    const { unmount } = render(
      <TaskAttributesBar
        task={{
          alertGroup: { id: 9, name: 'Test single Asin', isActive: false },
          alertType: 'PriceChanged',
        }}
        canEdit
        onEdit={vi.fn()}
      />,
    );
    const mark = screen.getByRole('img', { name: 'Inactive group' });
    expect(mark).toHaveAttribute('title', 'Inactive — this group is switched off');
    // Between the label and the name.
    expect(mark.previousElementSibling).toHaveTextContent('Alert Group');
    expect(mark.nextElementSibling).toHaveTextContent('Test single Asin');
    unmount();

    render(
      <TaskAttributesBar
        task={{
          alertGroup: { id: 4, name: 'Versure Exclusives', isActive: true },
          alertType: null,
        }}
        canEdit
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByRole('img', { name: 'Inactive group' })).not.toBeInTheDocument();
  });

  it('shows a dash for an attribute that is not set', () => {
    render(
      <TaskAttributesBar task={{ alertGroup: null, alertType: null }} canEdit onEdit={vi.fn()} />,
    );
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('gives editors the pencil, which opens the pop-up', () => {
    const onEdit = vi.fn();
    render(
      <TaskAttributesBar task={{ alertGroup: null, alertType: null }} canEdit onEdit={onEdit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit attributes' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('shows the values but no pencil to someone who cannot edit', () => {
    render(
      <TaskAttributesBar
        task={{ alertGroup: null, alertType: 'PriceChanged' }}
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('Price Changed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit attributes' })).not.toBeInTheDocument();
  });
});
