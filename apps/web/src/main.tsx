import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import './styles/index.css';
import { Layout } from './components/Layout';
import { RouteError } from './components/RouteError';
import { ThemeProvider } from './lib/theme';
import Overview from './routes/Overview';
import ScopeSelection from './routes/ScopeSelection';
import Programs from './routes/Programs';
import People from './routes/People';
import PersonDetail from './routes/PersonDetail';
import Labs from './routes/Labs';
import Queue from './routes/Queue';
import Applicant from './routes/Applicant';
import OutreachList from './routes/OutreachList';
import EmailWorkspace from './routes/EmailWorkspace';
import Review from './routes/Review';
import SendPlanner from './routes/SendPlanner';
import SentHistory from './routes/SentHistory';
import Connections from './routes/Connections';
import Settings from './routes/Settings';
import NotFound from './routes/NotFound';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        // A pathless layout route so a page error keeps the shell visible.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Overview /> },
          { path: 'scope', element: <ScopeSelection /> },
          { path: 'programs', element: <Programs /> },
          { path: 'people', element: <People /> },
          { path: 'people/:id', element: <PersonDetail /> },
          { path: 'labs', element: <Labs /> },
          { path: 'labs/:id', element: <Labs /> },
          { path: 'queue', element: <Queue /> },
          { path: 'applicant', element: <Applicant /> },
          { path: 'outreach', element: <OutreachList /> },
          { path: 'outreach/:id', element: <EmailWorkspace /> },
          { path: 'review', element: <Review /> },
          { path: 'planner', element: <SendPlanner /> },
          { path: 'sent', element: <SentHistory /> },
          { path: 'connections', element: <Connections /> },
          { path: 'settings', element: <Settings /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
