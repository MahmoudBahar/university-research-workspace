import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './motion';

/**
 * Counts from the previously shown number to `value` over `duration` ms with
 * an ease-out curve. With reduced motion the value is shown at once.
 */
export function useCountUp(value: number, duration = 700): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number>(reduced ? value : 0);
  const latest = useRef<number>(shown);

  useEffect(() => {
    if (reduced || !Number.isFinite(value)) {
      latest.current = value;
      setShown(value);
      return;
    }
    const startValue = latest.current;
    const delta = value - startValue;
    if (delta === 0) return;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = t >= 1 ? value : Math.round(startValue + delta * eased);
      latest.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return shown;
}
