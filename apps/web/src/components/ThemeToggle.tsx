import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Theme: light', icon: Sun },
  { value: 'dark', label: 'Theme: dark', icon: Moon },
  { value: 'system', label: 'Theme: system', icon: Monitor },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
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
          onClick={() => setPreference(option.value)}
        >
          <option.icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
