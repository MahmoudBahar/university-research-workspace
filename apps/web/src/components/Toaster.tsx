import type { CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastQueue, type ToastRecord } from '../lib/toast';
import { IconButton } from './IconButton';

const ICONS = { ok: CheckCircle2, warn: AlertTriangle, danger: XCircle, info: Info };

/**
 * Toasts announce through `aria-live` regions and never carry `role="status"`,
 * so inline notices remain the single status element a page shows.
 */
export function Toaster() {
  const { toasts, dismiss, pause, resume } = useToastQueue();
  const polite = toasts.filter((toast) => toast.kind !== 'danger');
  const assertive = toasts.filter((toast) => toast.kind === 'danger');
  return (
    <>
      <div className="toaster" aria-live="polite" aria-relevant="additions">
        {polite.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} onPause={pause} onResume={resume} />
        ))}
        <div aria-live="assertive" aria-relevant="additions" style={{ display: 'contents' }}>
          {assertive.map((toast) => (
            <ToastView key={toast.id} toast={toast} onDismiss={dismiss} onPause={pause} onResume={resume} />
          ))}
        </div>
      </div>
    </>
  );
}

function ToastView({
  toast,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const Icon = ICONS[toast.kind];
  return (
    <div
      className="toast"
      data-kind={toast.kind}
      data-leaving={toast.leaving ? 'true' : undefined}
      style={{ '--toast-duration': `${toast.duration}ms` } as CSSProperties}
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocus={() => onPause(toast.id)}
      onBlur={() => onResume(toast.id)}
    >
      <Icon className="toast-icon" aria-hidden="true" />
      <div className="toast-body">
        {toast.title ? <div className="toast-title">{toast.title}</div> : null}
        <div>{toast.message}</div>
      </div>
      <IconButton className="toast-dismiss" label="Dismiss notification" icon={X} size="small" onClick={() => onDismiss(toast.id)} />
    </div>
  );
}
