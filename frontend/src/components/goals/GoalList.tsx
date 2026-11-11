import type { GoalDto, GoalStatus } from '@healthy-tasks/shared';
import { GOAL_STATUSES, GOAL_STATUS_LABELS } from '@healthy-tasks/shared';
import { ChevronRight } from 'lucide-react';
import { Avatar, userLabel } from '../ui/Avatar';
import { Card, CardHead, Empty, cx } from '../harbor/ui';
import {
  GOAL_STATUS_TONE,
  GoalStatusPill,
  deadlineHint,
  formatDeadline,
  formatGoalValue,
} from './goalUi';

/**
 * The goal lifecycle as one row of steps, each with its count. Click a step to
 * show only those goals; click it again (or All) to show every goal.
 */
export function StageStrip({
  goals,
  value,
  onChange,
}: {
  goals: GoalDto[];
  value: GoalStatus | null;
  onChange: (s: GoalStatus | null) => void;
}) {
  return (
    <div className="hb-stages" role="group" aria-label="Filter by stage">
      <button
        type="button"
        className={cx('hb-stage is-all', value === null && 'is-on')}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        <b>{goals.length}</b>
        <span>All goals</span>
      </button>
      {GOAL_STATUSES.map((s, i) => {
        const n = goals.filter((g) => g.status === s).length;
        return (
          <button
            key={s}
            type="button"
            className={cx('hb-stage', `tone-${GOAL_STATUS_TONE[s]}`, value === s && 'is-on')}
            aria-pressed={value === s}
            onClick={() => onChange(value === s ? null : s)}
          >
            <b>{n}</b>
            <span>{GOAL_STATUS_LABELS[s]}</span>
            {i < GOAL_STATUSES.length - 1 && (
              <ChevronRight className="hb-stage-arrow" size={14} aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The goals as rows: what, how far, by when, and the stage pill. */
export function GoalRows({
  title,
  goals,
  selectedId,
  showOwner,
  empty,
  onOpen,
}: {
  title: string;
  goals: GoalDto[];
  selectedId: number | null;
  showOwner?: boolean;
  empty: string;
  onOpen: (g: GoalDto) => void;
}) {
  return (
    <Card className="hb-goals">
      <CardHead title={title} right={<span className="hb-small">{goals.length}</span>} />
      {goals.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        goals.map((g) => {
          const results = g.status !== 'Draft' && g.status !== 'PendingApproval';
          const due = deadlineHint(g);
          return (
            <button
              key={g.id}
              type="button"
              className={cx('hb-goalrow', selectedId === g.id && 'is-sel')}
              aria-pressed={selectedId === g.id}
              onClick={() => onOpen(g)}
            >
              <span className="hb-goalrow-main">
                <span className="hb-goalrow-title">{g.specific}</span>
                {showOwner && (
                  <span className="hb-sub hb-goalrow-owner">
                    <Avatar user={g.owner} size="xs" decorative />
                    {userLabel(g.owner)}
                  </span>
                )}
              </span>
              {/* Target and result side by side: goals don't say whether more or
                  less is better, so no percentage bar that could mislead. */}
              <span className="hb-goalrow-vals">
                <span>
                  <span className="hb-sub">Target</span>
                  {formatGoalValue(g.targetValue, g.metricType, g.unitLabel)}
                </span>
                <span>
                  <span className="hb-sub">Result</span>
                  {results ? formatGoalValue(g.resultValue, g.metricType, g.unitLabel) : '—'}
                </span>
              </span>
              <span className="hb-goalrow-due">
                <span>{formatDeadline(g.deadline)}</span>
                {due.text && <span className={cx('hb-sub', due.late && 'late')}>{due.text}</span>}
              </span>
              <GoalStatusPill status={g.status} />
            </button>
          );
        })
      )}
    </Card>
  );
}

/** The side panel when no goal is open: the lifecycle in plain words. */
export function HowGoalsWork({ supervisor }: { supervisor?: boolean }) {
  const steps: [string, string][] = supervisor
    ? [
        ['Draft', 'You or the employee write it: what, how much, by when.'],
        ['Pending approval', 'You approve it, or send it back with a reason.'],
        ['Approved', 'The employee records results as they go.'],
        ['Under review', 'They mark results final; you review them.'],
        ['Resolved', 'You set Exceeded, Met, Partially met or Missed, with a comment.'],
      ]
    : [
        ['Draft', 'Write it SMART: what, how much, by when. Edit as much as you like.'],
        ['Pending approval', 'Submit it; your supervisor approves or sends it back.'],
        ['Approved', 'Record results as you go.'],
        ['Under review', 'Mark results final when you’re done.'],
        ['Resolved', 'Your supervisor sets the outcome, with a comment.'],
      ];
  return (
    <Card>
      <CardHead tone="grey" title="How goals work" />
      <ol className="hb-ghow">
        {steps.map(([t, d], i) => (
          <li key={t}>
            <span className={cx('hb-ghow-n', `tone-${GOAL_STATUS_TONE[GOAL_STATUSES[i]!]}`)}>
              {i + 1}
            </span>
            <span className="hb-stack">
              <b>{t}</b>
              <span className="hb-sub">{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="hb-ghow-foot">Pick a goal to see it here.</p>
    </Card>
  );
}
