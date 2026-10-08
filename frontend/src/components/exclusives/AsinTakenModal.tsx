/**
 * "This ASIN is already monitored" (HLAI-71 Chunk 9, ticket 2).
 *
 * A product can be watched once per marketplace, so adding one that another
 * group already holds is a choice, not a failure: take it, and its history
 * comes along, or leave it where it is. It used to happen silently on save.
 */
import {
  EXCLUSIVES_MARKETPLACE_LABELS,
  type ExclusivesLookupListingDto,
  type ExclusivesMarketplace,
} from '@healthy-tasks/shared';
import { absoluteShort } from '../../lib/datetime';
import { Flag } from './Flag';
import { ModalDetailCard, ModalShell } from './ModalShell';

export function AsinTakenModal({
  asin,
  listing,
  groupName,
  onCancel,
  onMove,
}: {
  asin: string;
  /** The marketplace entry another group holds. */
  listing: ExclusivesLookupListingDto;
  /** The group being edited. New groups have no name yet. */
  groupName: string;
  onCancel: () => void;
  onMove: () => void;
}) {
  const where = EXCLUSIVES_MARKETPLACE_LABELS[listing.marketplace as ExclusivesMarketplace];
  const destination = groupName.trim() || 'this group';
  const added = [
    listing.addedAt ? `added ${absoluteShort(listing.addedAt)}` : null,
    listing.addedBy ? `by ${listing.addedBy}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ModalShell
      title="This ASIN is already monitored on this platform"
      tone="warn"
      role="alertdialog"
      width="min(640px, 94vw)"
      hint="An ASIN can be monitored once per platform."
      actions={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel insert
          </button>
          <button type="button" onClick={onMove}>
            Move it here
          </button>
        </>
      }
    >
      <p className="exc-confirm-sub">
        {asin} is already monitored for {where} in another group. An ASIN can be listed once per
        platform, so this ASIN could still be added for the other platform. Move the {where} entry
        into “{destination}”, or cancel and leave it where it is.
      </p>

      <ModalDetailCard tone="warn">
        <div className="exc-modal-card-head mono">
          <Flag platform={listing.marketplace} />
          <span>{asin}</span>
          <span aria-hidden="true">·</span>
          <span>{where}</span>
        </div>
        <p className="exc-modal-card-title">{listing.title ?? 'No title yet'}</p>
        <p className="exc-modal-card-meta">
          Currently in group: {listing.groupName ?? 'another group'}
          {added && ` · ${added}`}
        </p>
      </ModalDetailCard>
    </ModalShell>
  );
}
