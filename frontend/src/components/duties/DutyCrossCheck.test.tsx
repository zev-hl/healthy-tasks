import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DutyRef } from '@healthy-tasks/shared';
import { DutyCrossCheck } from './DutyCrossCheck';

const RECEIVING: DutyRef = {
  id: 'recv',
  name: 'Receiving',
  departmentId: 'ful',
  departmentName: 'Fulfillment',
  color: '#b8720a',
  archived: false,
};

function renderCheck(over: Partial<Parameters<typeof DutyCrossCheck>[0]> = {}) {
  const props = {
    personName: 'Grace Kim',
    personFirstName: 'Grace',
    duty: RECEIVING,
    blocking: true,
    canGrant: true,
    supervisorName: 'Dana Levin',
    onGrant: vi.fn(),
    onPickAssignee: vi.fn(),
    onClearDuty: vi.fn(),
    ...over,
  };
  render(<DutyCrossCheck {...props} />);
  return props;
}

describe('DutyCrossCheck', () => {
  it('blocks with the three fixes when the pair is being changed', () => {
    const props = renderCheck();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('err');
    expect(alert).toHaveTextContent('Grace Kim doesn’t hold the duty Fulfillment › Receiving');
    expect(alert).toHaveTextContent('can only go to someone who holds that duty');

    fireEvent.click(screen.getByRole('button', { name: 'Give Grace this duty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose someone who holds it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the duty' }));
    expect(props.onGrant).toHaveBeenCalledTimes(1);
    expect(props.onPickAssignee).toHaveBeenCalledTimes(1);
    expect(props.onClearDuty).toHaveBeenCalledTimes(1);
  });

  it('only warns about a mismatch that already existed', () => {
    renderCheck({ blocking: false });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('warn');
    expect(alert).toHaveTextContent('saved before the duty was taken away from Grace');
    expect(alert).toHaveTextContent('You can still save other changes');
  });

  it("says who can fix it when the viewer can't change the person's duties", () => {
    renderCheck({ canGrant: false });
    expect(screen.queryByRole('button', { name: /Give Grace/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only Dana Levin (Grace’s supervisor) or an Admin can change Grace’s duties.',
    );
  });
});
