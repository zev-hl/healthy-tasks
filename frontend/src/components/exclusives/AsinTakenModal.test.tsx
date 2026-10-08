import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ExclusivesLookupListingDto } from '@healthy-tasks/shared';
import { AsinTakenModal } from './AsinTakenModal';

const listing = (over: Partial<ExclusivesLookupListingDto> = {}): ExclusivesLookupListingDto => ({
  marketplace: 'Canada',
  sku: 'C-WF-3110-A',
  title: 'Nordic Vitality Omega 3-6-9 Complex, 120 Softgels',
  groupId: 3,
  groupName: 'Clearview Collagen',
  addedAt: '2026-08-19T09:00:00.000Z',
  addedBy: 'Dana Reyes',
  ...over,
});

const open = (props: Partial<Parameters<typeof AsinTakenModal>[0]> = {}) =>
  render(
    <AsinTakenModal
      asin={props.asin ?? 'B0C7QMV3RK'}
      listing={props.listing ?? listing()}
      groupName={props.groupName ?? 'Nordic Vitality — Omega line'}
      onCancel={props.onCancel ?? vi.fn()}
      onMove={props.onMove ?? vi.fn()}
    />,
  );

describe('AsinTakenModal', () => {
  it('explains the situation in terms of the marketplace involved', () => {
    open();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('This ASIN is already monitored on this platform');
    expect(dialog).toHaveTextContent('B0C7QMV3RK is already monitored for Canada');
    expect(dialog).toHaveTextContent('could still be added for the other platform');
    expect(dialog).toHaveTextContent('Nordic Vitality — Omega line');
  });

  it('shows the product, the group that holds it, and when it was added', () => {
    open();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Nordic Vitality Omega 3-6-9 Complex, 120 Softgels');
    expect(dialog).toHaveTextContent('Currently in group: Clearview Collagen');
    expect(dialog).toHaveTextContent('by Dana Reyes');
  });

  it('leaves the date out rather than printing a gap when it is unknown', () => {
    const { container } = open({ listing: listing({ addedAt: null, addedBy: null }) });
    // Scoped to the card: the prose above legitimately uses the word "added".
    const meta = container.querySelector('.exc-modal-card-meta') as HTMLElement;
    expect(meta.textContent).toBe('Currently in group: Clearview Collagen');
  });

  it('says a new group is "this group" rather than showing an empty name', () => {
    open({ groupName: '   ' });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('into “this group”');
  });

  it('offers the two choices, and reports which was taken', () => {
    const onCancel = vi.fn();
    const onMove = vi.fn();
    open({ onCancel, onMove });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel insert' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Move it here' }));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('states the rule behind the choice in the footer', () => {
    open();
    expect(screen.getByText('An ASIN can be monitored once per platform.')).toBeInTheDocument();
  });
});
