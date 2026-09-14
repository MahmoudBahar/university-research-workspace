import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  dueState,
  renderInZone,
  resolveLocalTime,
  suggestSendWindow,
  wallIntentDrift,
  temporalSource,
} from '@urw/core';

describe('time zones and planned sending', () => {
  test('a local time that does not exist is rejected', () => {
    // 2026-03-08 02:30 does not exist in America/Toronto: clocks jump 02:00 -> 03:00.
    assert.throws(
      () => resolveLocalTime({ date: '2026-03-08', time: '02:30', zone: 'America/Toronto' }),
      (error: unknown) =>
        error instanceof AppError && (error.detail as { code?: string }).code === 'nonexistent_local_time',
    );
  });

  test('an ambiguous local time requires an explicit occurrence', () => {
    // 2026-11-01 01:30 happens twice in America/Toronto.
    assert.throws(
      () => resolveLocalTime({ date: '2026-11-01', time: '01:30', zone: 'America/Toronto' }),
      (error: unknown) => error instanceof AppError && (error.detail as { code?: string }).code === 'ambiguous_local_time',
    );

    const earlier = resolveLocalTime({ date: '2026-11-01', time: '01:30', zone: 'America/Toronto', disambiguation: 'earlier' });
    const later = resolveLocalTime({ date: '2026-11-01', time: '01:30', zone: 'America/Toronto', disambiguation: 'later' });
    assert.notEqual(earlier.utcInstant, later.utcInstant);
    assert.equal(new Date(later.utcInstant).getTime() - new Date(earlier.utcInstant).getTime(), 3_600_000);
    assert.equal(earlier.offset, '-04:00');
    assert.equal(later.offset, '-05:00');
  });

  test('an ordinary local time converts through IANA rules, not a fixed offset', () => {
    const summer = resolveLocalTime({ date: '2026-07-15', time: '09:00', zone: 'America/Toronto' });
    const winter = resolveLocalTime({ date: '2026-01-15', time: '09:00', zone: 'America/Toronto' });
    assert.equal(summer.offset, '-04:00');
    assert.equal(winter.offset, '-05:00');
    assert.equal(summer.utcInstant, '2026-07-15T13:00:00Z');
    assert.equal(winter.utcInstant, '2026-01-15T14:00:00Z');
  });

  test('the same instant can fall on different dates for sender and recipient', () => {
    const plan = resolveLocalTime({ date: '2026-07-15', time: '09:00', zone: 'Asia/Tokyo' });
    const recipient = renderInZone(plan.utcInstant, 'Asia/Tokyo');
    const sender = renderInZone(plan.utcInstant, 'America/Vancouver');
    assert.equal(recipient.localDate, '2026-07-15');
    assert.equal(sender.localDate, '2026-07-14', 'the sender sees the previous day');
    assert.equal(sender.localTime, '17:00');
  });

  test('the suggested window is a labelled weekday morning, not a claim about response rates', () => {
    const suggestion = suggestSendWindow('America/Toronto', {
      startHour: 9,
      endHour: 11,
      weekdaysOnly: true,
      fromInstant: '2026-09-11T20:00:00Z', // Friday afternoon in Toronto
    });
    assert.match(suggestion.rationale, /convenience default, not a proven optimal time/);
    const rendered = renderInZone(suggestion.utcInstant, 'America/Toronto');
    assert.ok(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(rendered.weekday));
    assert.equal(rendered.localTime, '09:00');
  });

  test('an unknown zone is rejected rather than guessed', () => {
    assert.throws(
      () => resolveLocalTime({ date: '2026-07-15', time: '09:00', zone: 'Mars/Olympus' }),
      (error: unknown) => error instanceof AppError && error.code === 'invalid_input',
    );
  });

  test('due and overdue are calculated views only', () => {
    const instant = '2026-09-10T13:00:00Z';
    assert.equal(dueState(instant, new Date('2026-09-10T12:00:00Z')), 'scheduled');
    assert.equal(dueState(instant, new Date('2026-09-10T13:30:00Z')), 'due');
    assert.equal(dueState(instant, new Date('2026-09-12T13:30:00Z')), 'overdue');
  });

  test('a stored wall-clock intent is compared against recomputed rules', () => {
    const unchanged = wallIntentDrift({
      local_date: '2026-07-15',
      local_time: '09:00',
      recipient_zone: 'America/Toronto',
      utc_instant: '2026-07-15T13:00:00Z',
      disambiguation: null,
    });
    assert.equal(unchanged.drifted, false);

    const drifted = wallIntentDrift({
      local_date: '2026-07-15',
      local_time: '09:00',
      recipient_zone: 'America/Toronto',
      utc_instant: '2026-07-15T14:00:00Z',
      disambiguation: null,
    });
    assert.equal(drifted.drifted, true, 'a changed rule shows up as drift rather than silently moving the plan');
  });

  test('the Temporal implementation in use is reported', () => {
    assert.ok(['runtime', 'polyfill'].includes(temporalSource));
  });
});
