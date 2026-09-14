import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

/**
 * A modal built on the native `<dialog>`: focus trapping, Escape and an inert
 * background come from the platform. Focus returns to wherever it was.
 */
export function Dialog({
  open,
  onClose,
  label,
  children,
  className,
  showHeader = true,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  showHeader?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const onCloseEvent = () => {
      previousFocus.current?.focus?.();
    };
    const onClick = (event: MouseEvent) => {
      if (event.target === element) onClose();
    };
    element.addEventListener('cancel', onCancel);
    element.addEventListener('close', onCloseEvent);
    element.addEventListener('click', onClick);
    return () => {
      element.removeEventListener('cancel', onCancel);
      element.removeEventListener('close', onCloseEvent);
      element.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return (
    <dialog ref={ref} className={`dialog${className ? ` ${className}` : ''}`} aria-label={label}>
      {showHeader ? (
        <div className="dialog-head">
          <h3>{label}</h3>
          <span className="spacer" />
          <IconButton label="Close" icon={X} onClick={onClose} size="small" />
        </div>
      ) : null}
      <div className="dialog-body">{open ? children : null}</div>
    </dialog>
  );
}
