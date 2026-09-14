import type { MouseEvent } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Theme: light', icon: Sun },
  { value: 'dark', label: 'Theme: dark', icon: Moon },
  { value: 'system', label: 'Theme: system', icon: Monitor },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const choose = (value: ThemePreference, event: MouseEvent<HTMLButtonElement>) => {
    // Keyboard activation reports 0,0; use the button's centre so the reveal
    // still grows from the control.
    const rect = event.currentTarget.getBoundingClientRect();
    const origin =
      event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setPreference(value, origin);
  };
  return (
    <div className="segmented theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="icon small"
          aria-pressed={preference === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={(event) => choose(option.value, event)}
        >
          <option.icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
