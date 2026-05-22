import type { ReactNode } from 'react';
import type { LogEntry } from '@shared/models';

export type LogLevel = 'SYSTEM' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';
export type LogLevelFilter = 'ALL' | LogLevel;

export const LOG_LEVELS: LogLevel[] = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'SYSTEM'];
export const LOG_LEVEL_FILTERS: LogLevelFilter[] = ['ALL', ...LOG_LEVELS];

const MAX_MERGE_TEXT_LENGTH = 100 * 1024;

export function formatLogTime(value: string | undefined): string {
  if (!value) {
    return '--:--:--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return date.toLocaleTimeString([], { hour12: false });
}

export function getLogLevel(entry: LogEntry): LogLevel {
  if (entry.source === 'stderr') {
    return 'ERROR';
  }
  if (entry.source === 'system') {
    return 'SYSTEM';
  }
  const match = stripAnsiSequences(entry.text).match(/\b(INFO|WARN|ERROR|DEBUG|TRACE)\b/);
  return (match?.[1] as LogLevel | undefined) ?? 'INFO';
}

export function formatLogConsolePrefix(entry: LogEntry, level: LogLevel): string {
  return `${formatLogTime(entry.timestamp)} ${level}`;
}

export function stripAnsiSequences(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
}

export function getLogMessage(entry: LogEntry): string {
  return stripAnsiSequences(entry.text)
    .replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+\w+\s+/, '')
    .replace(
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3,9})?(?:Z|[+-]\d{2}:?\d{2})?\s+(?:INFO|WARN|ERROR|DEBUG|TRACE)\s+/,
      ''
    );
}

export function isRootCauseLog(entry: LogEntry): boolean {
  const text = getLogMessage(entry);
  return (
    text.includes('MalformedInputException') ||
    text.includes('parse data from Nacos error') ||
    text.includes('YAMLException') ||
    text.includes('Failed to configure a DataSource') ||
    text.includes('Failed to determine a suitable driver class')
  );
}

function shouldAppendToPreviousLog(previous: LogEntry | undefined, entry: LogEntry): boolean {
  if (!previous || previous.serviceId !== entry.serviceId || previous.source === 'system') {
    return false;
  }
  const previousLevel = getLogLevel(previous);
  if (previousLevel !== 'ERROR' && previous.source !== 'stderr') {
    return false;
  }
  const text = entry.text.trimStart();
  return (
    text.startsWith('at ') ||
    text.startsWith('... ') ||
    text.startsWith('Caused by:') ||
    text.startsWith('Suppressed:') ||
    /^[\w.$]+(?:Exception|Error):/.test(text)
  );
}

export function mergeLogEntries(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  const previous = entries[entries.length - 1];
  if (previous?.id === entry.id) {
    return [...entries.slice(0, -1), entry].slice(-2000);
  }
  if (!shouldAppendToPreviousLog(previous, entry)) {
    return [...entries, entry].slice(-2000);
  }
  const combined = `${previous.text}\n${entry.text}`;
  const merged = {
    ...previous,
    text: combined.length > MAX_MERGE_TEXT_LENGTH
      ? combined.slice(-MAX_MERGE_TEXT_LENGTH)
      : combined
  };
  return [...entries.slice(0, -1), merged].slice(-2000);
}

export function renderLogSearchHighlight(text: string, query: string, active: boolean) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return text;
  }

  const normalizedText = text.toLowerCase();
  const segments: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = normalizedText.indexOf(normalizedQuery);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      segments.push(text.slice(cursor, matchIndex));
    }

    const nextCursor = matchIndex + normalizedQuery.length;
    segments.push(
      <mark
        className={`pilot-terminal__search-hit ${active ? 'pilot-terminal__search-hit--active' : ''}`}
        key={`${matchIndex}-${nextCursor}`}
      >
        {text.slice(matchIndex, nextCursor)}
      </mark>
    );
    cursor = nextCursor;
    matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  return segments;
}
