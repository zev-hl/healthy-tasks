import { Activity } from 'lucide-react';
import { Card, CardHead, Pill } from '../../components/harbor/ui';

/**
 * The brief's activity feed (My activity / the team's activity for the period).
 * History is stored per task and nothing lists it across tasks yet (backend job
 * 8), so the card holds its place as "coming soon" rather than being left out.
 */
export function ActivitySoon({ team = false }: { team?: boolean }) {
  return (
    <Card className="hb-soon-card">
      <CardHead
        icon={<Activity size={16} />}
        tone="grey"
        title={team ? 'Team activity' : 'My activity'}
        right={<Pill tone="grey">Coming soon</Pill>}
      />
      <p className="hb-soon-text">
        {team
          ? 'What your team changed in this period: status changes, comments and finished tasks. '
          : 'What you did in this period: status changes, comments and finished tasks. '}
        It needs a backend change first.
      </p>
    </Card>
  );
}
