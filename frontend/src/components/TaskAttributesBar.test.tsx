import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TaskAttributesBar } from './TaskAttributesBar';

describe('TaskAttributesBar', () => {
  it('lists each attribute with its value', () => {
    render(
      <TaskAttributesBar
        task={{
          alertGroup: { id: 4, name: 'Versure Exclusives', isActive: true },
          alertType: 'BuyBoxLost',
        }}
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
      />,
    );
    expect(screen.queryByRole('img', { name: 'Inactive group' })).not.toBeInTheDocument();
  });

  it('shows a dash for an attribute that is not set', () => {
    render(<TaskAttributesBar task={{ alertGroup: null, alertType: null }} />);
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows the values, with no edit control (editors get the chips instead)', () => {
    render(<TaskAttributesBar task={{ alertGroup: null, alertType: 'PriceChanged' }} />);
    expect(screen.getByText('Price Changed')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
