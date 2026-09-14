import { Temporal as PolyfillTemporal } from 'temporal-polyfill';

type TemporalApi = typeof PolyfillTemporal;

/**
 * Use the runtime's Temporal when it exists (Node 24+ ships it behind the same
 * API surface) and fall back to the maintained polyfill otherwise. Either way
 * the zone rules come from the platform's IANA database, not fixed offsets.
 */
const runtimeTemporal = (globalThis as { Temporal?: TemporalApi }).Temporal;

export const Temporal: TemporalApi = runtimeTemporal ?? PolyfillTemporal;

export const temporalSource: 'runtime' | 'polyfill' = runtimeTemporal ? 'runtime' : 'polyfill';

export function isValidTimeZone(zone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(zone);
    return true;
  } catch {
    return false;
  }
}

export function systemTimeZone(): string {
  try {
    return Temporal.Now.timeZoneId();
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  }
}
