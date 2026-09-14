import type { CSSProperties } from 'react';

export function Skeleton({ width, height, className, style }: { width?: string | number; height?: string | number; className?: string; style?: CSSProperties }) {
  return <span className={`skeleton${className ? ` ${className}` : ''}`} aria-hidden="true" style={{ width, height, ...style }} />;
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 4, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="skeleton-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} width={`${55 + ((row * 7 + column * 13) % 40)}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton width="40%" height="1.1em" />
      <SkeletonLines lines={4} />
    </div>
  );
}
