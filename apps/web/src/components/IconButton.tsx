import type { ButtonHTMLAttributes, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: LucideIcon;
  pressed?: boolean;
  variant?: 'ghost' | 'default';
  size?: 'small' | 'default';
  ref?: Ref<HTMLButtonElement>;
}

/** A button that is only an icon. The label is what assistive technology reads. */
export function IconButton({ label, icon: Icon, pressed, variant = 'ghost', size = 'default', className, type, ...rest }: IconButtonProps) {
  const classes = ['icon', variant === 'ghost' ? 'ghost' : '', size === 'small' ? 'small' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type ?? 'button'} className={classes} aria-label={label} title={label} aria-pressed={pressed} {...rest}>
      <Icon aria-hidden="true" />
    </button>
  );
}
