import { dutyLabel, type DutyRef } from '@healthy-tasks/shared';

/**
 * The assignee ⇄ duty message under a task's fields. Red and blocking while the
 * assignee or duty is being changed into a mismatch; amber when the mismatch
 * already existed (a duty taken away after assignment) so unrelated edits still
 * save. Offers the three fixes; "Give this duty" only to someone allowed to
 * change that person's duties.
 */
export function DutyCrossCheck({
  personName,
  personFirstName,
  duty,
  blocking,
  canGrant,
  supervisorName,
  granting = false,
  onGrant,
  onPickAssignee,
  onClearDuty,
}: {
  personName: string;
  personFirstName: string;
  duty: DutyRef;
  blocking: boolean;
  canGrant: boolean;
  supervisorName: string | null;
  granting?: boolean;
  onGrant: () => void;
  onPickAssignee: () => void;
  onClearDuty: () => void;
}) {
  return (
    <div className={`duty-xcheck ${blocking ? 'err' : 'warn'}`} role="alert">
      <div className="duty-xc-icon" aria-hidden="true">
        <span>!</span>
      </div>
      <div>
        <div className="duty-xc-title">
          {personName} doesn’t hold the duty {dutyLabel(duty)}
        </div>
        <div className="duty-xc-text">
          {blocking
            ? 'A task with a duty can only go to someone who holds that duty. Change the assignee or the duty, or give the duty to this person, and then save.'
            : `This task was saved before the duty was taken away from ${personFirstName}. It’s flagged ⚠ in lists. You can still save other changes.`}
        </div>
        <div className="duty-xc-actions">
          {canGrant ? (
            <button type="button" className="btn-sm" disabled={granting} onClick={onGrant}>
              {granting ? 'Giving…' : `Give ${personFirstName} this duty`}
            </button>
          ) : (
            <span className="duty-xc-perm">
              Only {supervisorName ?? 'an Admin'}
              {supervisorName ? ` (${personFirstName}’s supervisor) or an Admin` : ''} can change{' '}
              {personFirstName}’s duties.
            </span>
          )}
          <button type="button" className="secondary btn-sm" onClick={onPickAssignee}>
            Choose someone who holds it
          </button>
          <button type="button" className="secondary btn-sm" onClick={onClearDuty}>
            Remove the duty
          </button>
        </div>
      </div>
    </div>
  );
}
