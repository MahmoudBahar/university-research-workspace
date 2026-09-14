import { Compass } from 'lucide-react';
import { AppLink } from '../components/AppLink';
import { EmptyState } from '../components/EmptyState';

export default function NotFound() {
  return (
    <>
      <header>
        <h2>Page not found</h2>
      </header>
      <EmptyState icon={Compass} title="There is nothing at this address.">
        <AppLink to="/">Back to the overview</AppLink> · <AppLink to="/people">People</AppLink> · <AppLink to="/queue">Queue</AppLink>
      </EmptyState>
    </>
  );
}
