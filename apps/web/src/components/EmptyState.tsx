import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CopyButton } from './CopyButton';

export function EmptyState({ icon: Icon, title, children, command }: { icon: LucideIcon; title: string; children?: ReactNode; command?: string }) {
  return (
    <div className="empty-state">
      <Icon className="empty-icon" aria-hidden="true" />
      <div className="empty-title">{title}</div>
      {children ? <div className="small">{children}</div> : null}
      {command ? (
        <div className="empty-command">
          <code>{command}</code>
          <CopyButton value={command} label="command" size="small" />
        </div>
      ) : null}
    </div>
  );
}
