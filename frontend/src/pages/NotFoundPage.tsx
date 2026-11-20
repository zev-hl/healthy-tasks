import { Link } from 'react-router-dom';
import { Lock, MapPinOff } from 'lucide-react';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Card, Empty } from '../components/harbor/ui';

/** An address inside the app that leads nowhere (a mistyped or old link). */
export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" search={false} newTask={false} tabs={<></>} />
      <PageBody>
        <Card>
          <Empty>
            <MapPinOff size={18} aria-hidden="true" /> There’s no page at this address. The link may
            be old or mistyped. <Link to="/">Go to the Dashboard</Link>
          </Empty>
        </Card>
      </PageBody>
    </>
  );
}

/** A page this person's role may not open (Admins only, say). */
export function NoAccessPage() {
  return (
    <>
      <PageHeader
        title="You don’t have access to this page"
        search={false}
        newTask={false}
        tabs={<></>}
      />
      <PageBody>
        <Card>
          <Empty>
            <Lock size={18} aria-hidden="true" /> This page is only for some roles. If you need it,
            ask an Admin. <Link to="/">Go to the Dashboard</Link>
          </Empty>
        </Card>
      </PageBody>
    </>
  );
}
