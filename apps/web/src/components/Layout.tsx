import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { bootstrap, type Bootstrap } from '../lib/api';
import { useGlobalShortcuts } from '../lib/shortcuts';
import { ToastProvider } from '../lib/toast';
import { UniversityProvider } from '../lib/university';
import { useChangeFeed } from '../lib/useApi';
import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Sidebar } from './Sidebar';
import { Toaster } from './Toaster';
import { TopBar } from './TopBar';
import { ErrorBanner, Loading } from './ui';

export function Layout() {
  const [boot, setBoot] = useState<Bootstrap | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const location = useLocation();

  const load = () => {
    bootstrap()
      .then(setBoot)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause : new Error(String(cause))));
  };

  useEffect(load, [location.pathname]);
  useChangeFeed(load);

  return (
    <ToastProvider>
      <UniversityProvider universities={boot?.status.universities ?? []}>
        <Shell boot={boot} error={error} />
      </UniversityProvider>
    </ToastProvider>
  );
}

function Shell({ boot, error }: { boot: Bootstrap | undefined; error: Error | undefined }) {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const hamburger = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // While the drawer is open on a small screen, the page behind it is inert.
  useEffect(() => {
    const element = main.current;
    if (!element) return;
    const small = window.matchMedia('(max-width: 900px)').matches;
    element.inert = drawerOpen && small;
    return () => {
      element.inert = false;
    };
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const returnFocus = useCallback(() => hamburger.current?.focus(), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useGlobalShortcuts({ onPalette: openPalette, onHelp: openHelp, onEscape: closeDrawer });

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar boot={boot} open={drawerOpen} onClose={closeDrawer} returnFocusTo={returnFocus} />
      <TopBar ref={hamburger} onOpenDrawer={() => setDrawerOpen(true)} onOpenPalette={openPalette} onOpenHelp={openHelp} drawerOpen={drawerOpen} />
      <main className="main" id="main" ref={main}>
        <ErrorBanner error={error} />
        {!boot && !error ? <Loading what="workspace" /> : null}
        {boot ? <Outlet context={boot} /> : null}
      </main>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <ShortcutsDialog open={helpOpen} onClose={closeHelp} />
      <Toaster />
    </div>
  );
}
