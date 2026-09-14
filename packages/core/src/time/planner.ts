import { AppError } from '../util/errors.js';
import { Temporal, isValidTimeZone } from './temporal.js';

export type Disambiguation = 'earlier' | 'later';

export interface ResolvedLocalTime {
  utcInstant: string;
  localDate: string;
  localTime: string;
  zone: string;
  offset: string;
  disambiguation: Disambiguation | null;
  ambiguous: boolean;
}

export interface LocalTimeInput {
  date: string;
  time: string;
  zone: string;
  disambiguation?: Disambiguation;
}

function plainDateTime(date: string, time: string): InstanceType<typeof Temporal.PlainDateTime> {
  try {
    return Temporal.PlainDateTime.from(`${date}T${time}:00`);
  } catch (error) {
    throw new AppError('invalid_input', `Invalid local date/time: ${date} ${time}`, { message: (error as Error).message });
  }
}

/**
 * Convert a wall-clock intent into an exact instant.
 *
 * A local time that does not exist (spring-forward gap) is rejected. A local
 * time that happens twice (autumn fall-back) requires the caller to choose the
 * occurrence explicitly; guessing would silently move the message by an hour.
 */
export function resolveLocalTime(input: LocalTimeInput): ResolvedLocalTime {
  if (!isValidTimeZone(input.zone)) {
    throw new AppError('invalid_input', `Unknown IANA time zone: ${input.zone}`, { zone: input.zone });
  }
  const pdt = plainDateTime(input.date, input.time);
  const earlier = pdt.toZonedDateTime(input.zone, { disambiguation: 'earlier' });
  const later = pdt.toZonedDateTime(input.zone, { disambiguation: 'later' });

  if (earlier.epochNanoseconds === later.epochNanoseconds) {
    // A single instant maps to this wall time.
    return {
      utcInstant: earlier.toInstant().toString(),
      localDate: input.date,
      localTime: input.time,
      zone: input.zone,
      offset: earlier.offset,
      disambiguation: null,
      ambiguous: false,
    };
  }

  // Two candidates. If neither preserves the requested wall time, the local time
  // falls in a spring-forward gap and simply does not exist.
  const preservesWallTime = earlier.toPlainDateTime().equals(pdt);
  if (!preservesWallTime) {
    throw new AppError(
      'invalid_input',
      `${input.date} ${input.time} does not exist in ${input.zone}: the clocks move forward over that local time. Choose another time.`,
      {
        code: 'nonexistent_local_time',
        zone: input.zone,
        requested: `${input.date}T${input.time}`,
        nearestBefore: earlier.toPlainDateTime().toString(),
        nearestAfter: later.toPlainDateTime().toString(),
      },
    );
  }

  if (!input.disambiguation) {
    throw new AppError(
      'invalid_input',
      `${input.date} ${input.time} occurs twice in ${input.zone}. Choose the earlier or later occurrence.`,
      {
        code: 'ambiguous_local_time',
        zone: input.zone,
        options: [
          { occurrence: 'earlier', instant: earlier.toInstant().toString(), offset: earlier.offset },
          { occurrence: 'later', instant: later.toInstant().toString(), offset: later.offset },
        ],
      },
    );
  }
  const chosen = input.disambiguation === 'earlier' ? earlier : later;
  return {
    utcInstant: chosen.toInstant().toString(),
    localDate: input.date,
    localTime: input.time,
    zone: input.zone,
    offset: chosen.offset,
    disambiguation: input.disambiguation,
    ambiguous: true,
  };
}

export interface WindowSuggestion {
  date: string;
  time: string;
  zone: string;
  utcInstant: string;
  windowEndTime: string;
  rationale: string;
}

/**
 * Convenience suggestion only: a weekday morning in the recipient's zone.
 * It is not evidence that any particular time produces a better response.
 */
export function suggestSendWindow(
  zone: string,
  options: { startHour?: number; endHour?: number; weekdaysOnly?: boolean; fromInstant?: string } = {},
): WindowSuggestion {
  if (!isValidTimeZone(zone)) {
    throw new AppError('invalid_input', `Unknown IANA time zone: ${zone}`, { zone });
  }
  const startHour = options.startHour ?? 9;
  const endHour = options.endHour ?? 11;
  const weekdaysOnly = options.weekdaysOnly ?? true;
  const now = options.fromInstant
    ? Temporal.Instant.from(options.fromInstant).toZonedDateTimeISO(zone)
    : Temporal.Now.zonedDateTimeISO(zone);

  let candidate = now.with({ hour: startHour, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
  if (Temporal.ZonedDateTime.compare(candidate, now) <= 0) candidate = candidate.add({ days: 1 });
  if (weekdaysOnly) {
    while (candidate.dayOfWeek > 5) candidate = candidate.add({ days: 1 });
  }

  const time = `${String(candidate.hour).padStart(2, '0')}:${String(candidate.minute).padStart(2, '0')}`;
  const date = candidate.toPlainDate().toString();
  const resolved = resolveLocalTime({ date, time, zone });
  return {
    date,
    time,
    zone,
    utcInstant: resolved.utcInstant,
    windowEndTime: `${String(endHour).padStart(2, '0')}:00`,
    rationale: `Suggested weekday window ${String(startHour).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00 in ${zone}. This is an editable convenience default, not a proven optimal time.`,
  };
}

export type DueState = 'scheduled' | 'due' | 'overdue';

/** Due and overdue are calculated views. Nothing about them sends a message. */
export function dueState(utcInstant: string, now: Date = new Date(), overdueAfterHours = 24): DueState {
  const target = new Date(utcInstant).getTime();
  const current = now.getTime();
  if (current < target) return 'scheduled';
  if (current < target + overdueAfterHours * 3_600_000) return 'due';
  return 'overdue';
}

export interface ZoneRendering {
  instant: string;
  zone: string;
  localDate: string;
  localTime: string;
  offset: string;
  weekday: string;
  formatted: string;
}

export function renderInZone(utcInstant: string, zone: string): ZoneRendering {
  const zdt = Temporal.Instant.from(utcInstant).toZonedDateTimeISO(zone);
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const localDate = zdt.toPlainDate().toString();
  const localTime = `${String(zdt.hour).padStart(2, '0')}:${String(zdt.minute).padStart(2, '0')}`;
  return {
    instant: utcInstant,
    zone,
    localDate,
    localTime,
    offset: zdt.offset,
    weekday: weekdays[zdt.dayOfWeek - 1] as string,
    formatted: `${localDate} ${localTime} (${zdt.offset}, ${zone})`,
  };
}

/**
 * Detect a timezone-rule change: the stored wall-clock intent no longer maps to
 * the instant that was computed when the plan was made.
 */
export function wallIntentDrift(plan: {
  local_date: string;
  local_time: string;
  recipient_zone: string;
  utc_instant: string;
  disambiguation: string | null;
}): { drifted: boolean; recomputedInstant: string | null; reason?: string } {
  try {
    const resolved = resolveLocalTime({
      date: plan.local_date,
      time: plan.local_time,
      zone: plan.recipient_zone,
      disambiguation: (plan.disambiguation as Disambiguation) ?? undefined,
    });
    return {
      drifted: resolved.utcInstant !== plan.utc_instant,
      recomputedInstant: resolved.utcInstant,
    };
  } catch (error) {
    return {
      drifted: true,
      recomputedInstant: null,
      reason: error instanceof AppError ? error.message : String(error),
    };
  }
}
