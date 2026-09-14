import { forwardRef } from 'react';
import { CircleHelp, Menu, Search } from 'lucide-react';
import { IconButton } from './IconButton';
import { Kbd } from './Kbd';
import { ThemeToggle } from './ThemeToggle';
import { UniversitySwitcher } from './UniversitySwitcher';

export const TopBar = forwardRef<HTMLButtonElement, { onOpenDrawer: () => void; onOpenPalette: () => void; onOpenHelp: () => void; drawerOpen: boolean }>(
  function TopBar({ onOpenDrawer, onOpenPalette, onOpenHelp, drawerOpen }, hamburgerRef) {
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    return (
      <div className="topbar">
        <IconButton
          ref={hamburgerRef}
          className="hamburger"
          label="Open navigation"
          icon={Menu}
          onClick={onOpenDrawer}
          aria-expanded={drawerOpen}
          aria-controls="sidebar"
        />
        <span className="brand">Research workspace</span>
        <UniversitySwitcher />
        <button type="button" className="search-button" onClick={onOpenPalette} aria-label="Search and commands" aria-keyshortcuts="Control+K">
          <Search aria-hidden="true" />
          <span className="search-label">Search people, programs, drafts…</span>
          <span className="kbd-group" aria-hidden="true">
            <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <div className="topbar-actions">
          <ThemeToggle />
          <IconButton label="Keyboard shortcuts" icon={CircleHelp} onClick={onOpenHelp} />
        </div>
      </div>
    );
  },
);
