import { describe, expect, it } from 'vitest';
import type { LogEntry } from '@shared/models';
import { mergeLogEntries } from './log-utils';

function entry(id: string, text = id): LogEntry {
  return {
    id,
    serviceId: 'service-1',
    timestamp: `2026-07-21T00:00:${id.padStart(2, '0')}.000Z`,
    source: 'stdout',
    text
  };
}

describe('mergeLogEntries', () => {
  it('keeps a bounded tail when a service emits many log lines', () => {
    const entries = Array.from({ length: 600 }, (_, index) => entry(String(index)));
    const merged = entries.reduce<LogEntry[]>(mergeLogEntries, []);

    expect(merged).toHaveLength(500);
    expect(merged[0].id).toBe('100');
    expect(merged.at(-1)?.id).toBe('599');
  });

  it('truncates oversized log lines before retaining them in the renderer', () => {
    const merged = mergeLogEntries([], entry('large', 'x'.repeat(20 * 1024)));

    expect(merged[0].text).toHaveLength(16 * 1024);
  });
});
