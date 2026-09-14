export function ProgressBar({
  value,
  max,
  label,
  tone,
  compact,
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'ok' | 'warn';
  compact?: boolean;
}) {
  const percent = max > 0 ? Math.round((Math.min(value, max) / max) * 100) : 0;
  const resolvedTone = tone ?? (max > 0 && value >= max ? 'ok' : undefined);
  return (
    <div
      className={`progress${compact ? ' compact' : ''}${resolvedTone ? ` ${resolvedTone}` : ''}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className="track">
        <div className="fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="text">
        {value}/{max}
      </span>
    </div>
  );
}
