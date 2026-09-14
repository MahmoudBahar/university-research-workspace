import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { AppLink } from './AppLink';
import { Notice } from './ui';

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error interrupted this page.';
  return (
    <div className="route-error">
      <header>
        <h2>This page hit a problem</h2>
      </header>
      <Notice kind="danger" title="Error:">
        {message}
      </Notice>
      <p className="small muted">Your saved state is untouched. Reload the page, or go back to the overview.</p>
      <AppLink className="button" to="/">
        Back to overview
      </AppLink>
    </div>
  );
}
