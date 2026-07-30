import type { GoalDto } from '@healthy-tasks/shared';
import { UserChip } from '../ui/Avatar';
import { GoalStatusPill, formatGoalValue, formatDeadline } from './goalUi';

interface Props {
  goal: GoalDto;
  /** Show the owner chip (Team Goals lists goals of many people). */
  showOwner?: boolean;
  onOpen: (goal: GoalDto) => void;
}

/** A compact, clickable goal summary card (shared by My Goals + Team Goals). */
export function GoalCard({ goal, showOwner = false, onOpen }: Props) {
  const unit = goal.unitLabel;
  const hasResult = goal.status !== 'Draft' && goal.status !== 'PendingApproval';
  return (
    <button type="button" className="goal-card" onClick={() => onOpen(goal)}>
      <div className="goal-card-top">
        <span className="goal-card-title">{goal.specific}</span>
        <GoalStatusPill status={goal.status} />
      </div>
      <div className="goal-card-meta">
        <span className="goal-card-metric">
          <span className="u-label">Target</span> {formatGoalValue(goal.targetValue, goal.metricType, unit)}
          {hasResult && (
            <>
              <span className="goal-card-sep">·</span>
              <span className="u-label">Result</span>{' '}
              {formatGoalValue(goal.resultValue, goal.metricType, unit)}
            </>
          )}
        </span>
        <span className="goal-card-deadline">Due {formatDeadline(goal.deadline)}</span>
      </div>
      {showOwner && (
        <div className="goal-card-owner">
          <UserChip user={goal.owner} showTitle />
        </div>
      )}
    </button>
  );
}
