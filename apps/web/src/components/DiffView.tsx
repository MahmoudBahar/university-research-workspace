import { useMemo } from 'react';
import { diffLines } from '../lib/diff';

export function DiffView({ before, after, beforeLabel = 'before', afterLabel = 'after' }: { before: string; after: string; beforeLabel?: string; afterLabel?: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const added = lines.filter((line) => line.type === 'add').length;
  const removed = lines.filter((line) => line.type === 'del').length;
  return (
    <div className="diff" aria-label={`Differences between ${beforeLabel} and ${afterLabel}`}>
      <div className="diff-head">
        <span>{beforeLabel}</span>
        <span>→</span>
        <span>{afterLabel}</span>
        <span className="spacer" />
        <span>
          +{added} −{removed}
        </span>
      </div>
      {added === 0 && removed === 0 ? <div className="diff-summary">The two revisions have the same body.</div> : null}
      {lines.map((line, index) => (
        <div key={index} className={`diff-line ${line.type}`}>
          <span className="marker" aria-hidden="true">
            {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
          </span>
          <span>{line.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}
