import { describe, expect, it } from 'vitest';
import { captureDestinationLabel, captureStateLabel, formatBytes, formatMediaDuration, formatTimestamp, ruPlural, taskPriorityLabel, taskStatusLabel } from './desktop-format';

describe('desktop formatting', () => {
  it('formats sizes up to gigabytes with one shared formatter', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB');
  });

  it('formats media durations and clamps negative values', () => {
    expect(formatMediaDuration(65_400)).toBe('1:05');
    expect(formatMediaDuration(-1)).toBe('0:00');
  });

  it('shows timestamps for people, not ISO strings', () => {
    const iso = '2026-11-05T15:18:55.145Z';
    expect(formatTimestamp(iso, true)).not.toContain('T15:18');
    expect(formatTimestamp(iso, true)).toContain('2026');
    expect(formatTimestamp('not a date', true)).toBe('not a date');
    expect(formatTimestamp(undefined, false)).toBe('');
  });

  it('uses Russian plural forms', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(count => ruPlural(count, 'результат', 'результата', 'результатов'))).toEqual(['результат', 'результата', 'результатов', 'результатов', 'результат', 'результата', 'результатов']);
  });

  it('labels Core task and capture enums in both languages', () => {
    expect(taskStatusLabel('OPEN', true)).toBe('Активна');
    expect(taskStatusLabel('CANCELED', false)).toBe('Canceled');
    expect(taskPriorityLabel('NONE', true)).toBe('');
    expect(taskPriorityLabel('HIGH', true)).toBe('Высокий приоритет');
    expect(captureStateLabel('ROUTED', true)).toBe('Разобрано');
    expect(captureStateLabel('UNKNOWN_STATE', true)).toBe('UNKNOWN_STATE');
    expect(captureDestinationLabel('TASK', false)).toBe('Task');
  });
});
