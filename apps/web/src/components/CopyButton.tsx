import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useToast } from '../lib/toast';

/** Copies text to the clipboard. Copying is never sending. */
export function CopyButton({
  value,
  label,
  buttonLabel,
  size,
  disabled,
  onCopied,
}: {
  value: string;
  /** What is being copied, for the toast: "body", "recipient". */
  label: string;
  /** Visible button text; defaults to `Copy <label>`. */
  buttonLabel?: string;
  size?: 'small';
  disabled?: boolean;
  onCopied?: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const text = buttonLabel ?? `Copy ${label}`;

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      toast({ kind: 'ok', message: `Copied the ${label}. Copying is not sending.` });
      onCopied?.();
    } catch {
      toast({ kind: 'warn', message: `The browser refused clipboard access. Select the ${label} and copy it by hand.` });
    }
  };

  return (
    <button type="button" onClick={copy} disabled={disabled} className={size === 'small' ? 'ghost' : undefined} aria-label={text}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {size === 'small' ? null : text}
    </button>
  );
}
