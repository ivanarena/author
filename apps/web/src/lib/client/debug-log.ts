export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugLogEntry {
  id: string;
  at: string;
  level: DebugLogLevel;
  source: string;
  message: string;
  detail: string;
}

const DEBUG_LOG_STORAGE_KEY = 'author-debug-log-v1';
const DEBUG_LOG_UPDATED_EVENT = 'author-debug-log-updated';
const MAX_DEBUG_LOG_ENTRIES = 200;
const MAX_DEBUG_LOG_FIELD_LENGTH = 4000;
const REDACTED_DEBUG_VALUE = '[redacted]';

let frontendLoggingCleanup: (() => void) | null = null;

export function loadDebugLogEntries(): DebugLogEntry[] {
  return readDebugLogEntries();
}

export function recordDebugLog(entry: {
  level?: DebugLogLevel;
  source: string;
  message: string;
  detail?: unknown;
}): void {
  const storage = getDebugStorage();
  if (!storage) return;

  const nextEntry: DebugLogEntry = {
    id: debugLogId(),
    at: new Date().toISOString(),
    level: entry.level ?? 'info',
    source: sanitizeDebugLogField(entry.source || 'App'),
    message: sanitizeDebugLogField(entry.message || 'Log entry'),
    detail: debugLogDetail(entry.detail)
  };
  const entries = [...readDebugLogEntries(storage), nextEntry].slice(
    -MAX_DEBUG_LOG_ENTRIES
  );
  writeDebugLogEntries(storage, entries);
  dispatchDebugLogUpdated();
}

export function clearDebugLog(): void {
  const storage = getDebugStorage();
  if (!storage) return;
  try {
    storage.removeItem(DEBUG_LOG_STORAGE_KEY);
  } catch {
    return;
  }
  dispatchDebugLogUpdated();
}

export function formatDebugLogEntries(entries: DebugLogEntry[]): string {
  if (!entries.length) return 'No diagnostic logs recorded on this browser.';
  return entries.map(formatDebugLogEntry).join('\n\n');
}

export function installFrontendDebugLogging(): () => void {
  if (frontendLoggingCleanup) return frontendLoggingCleanup;
  if (typeof window === 'undefined') return () => {};

  const handleError = (event: ErrorEvent) => {
    recordDebugLog({
      level: 'error',
      source: 'Frontend',
      message: event.message || 'Unhandled frontend error',
      detail:
        event.error instanceof Error
          ? event.error
          : `${event.filename}:${event.lineno}:${event.colno}`
    });
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    recordDebugLog({
      level: 'error',
      source: 'Frontend',
      message: 'Unhandled promise rejection',
      detail: event.reason
    });
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);
  recordDebugLog({
    level: 'debug',
    source: 'Frontend',
    message: 'Diagnostics logging started'
  });

  frontendLoggingCleanup = () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
    frontendLoggingCleanup = null;
  };
  return frontendLoggingCleanup;
}

export function debugLogUpdatedEventName(): string {
  return DEBUG_LOG_UPDATED_EVENT;
}

function readDebugLogEntries(storage = getDebugStorage()): DebugLogEntry[] {
  if (!storage) return [];
  try {
    const stored = storage.getItem(DEBUG_LOG_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDebugLogEntry).slice(-MAX_DEBUG_LOG_ENTRIES);
  } catch {
    return [];
  }
}

function writeDebugLogEntries(
  storage: Storage,
  entries: DebugLogEntry[]
): void {
  try {
    storage.setItem(DEBUG_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics should never block writing.
  }
}

function dispatchDebugLogUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEBUG_LOG_UPDATED_EVENT));
}

function getDebugStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return null;
    }
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function debugLogId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sanitizeDebugLogField(value: string): string {
  return redactDebugLogSecrets(value)
    .replace(/\0/g, '')
    .slice(0, MAX_DEBUG_LOG_FIELD_LENGTH);
}

function debugLogDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return '';
  if (detail instanceof Error) {
    return sanitizeDebugLogField(
      detail.stack ?? `${detail.name}: ${detail.message}`
    );
  }
  if (typeof detail === 'string') return sanitizeDebugLogField(detail);
  try {
    return sanitizeDebugLogField(JSON.stringify(detail));
  } catch {
    return sanitizeDebugLogField(String(detail));
  }
}

function formatDebugLogEntry(entry: DebugLogEntry): string {
  const heading = [
    formatDebugLogTime(entry.at),
    entry.level.toUpperCase(),
    entry.source,
    entry.message
  ].join(' | ');
  return entry.detail ? `${heading}\n${entry.detail}` : heading;
}

function formatDebugLogTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
}

function isDebugLogEntry(value: unknown): value is DebugLogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as DebugLogEntry;
  return (
    typeof entry.id === 'string' &&
    typeof entry.at === 'string' &&
    ['debug', 'info', 'warn', 'error'].includes(entry.level) &&
    typeof entry.source === 'string' &&
    typeof entry.message === 'string' &&
    typeof entry.detail === 'string'
  );
}

function redactDebugLogSecrets(value: string): string {
  return value
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED_DEBUG_VALUE}`)
    .replace(
      /("(?:authorization|token|authToken|password|secret|e2eeKeyring|recoveryCode|keyMaterial|deviceTrustSecret)"\s*:\s*)"[^"]*"/gi,
      `$1"${REDACTED_DEBUG_VALUE}"`
    )
    .replace(
      /('(?:authorization|token|authToken|password|secret|e2eeKeyring|recoveryCode|keyMaterial|deviceTrustSecret)'\s*:\s*)'[^']*'/gi,
      `$1'${REDACTED_DEBUG_VALUE}'`
    )
    .replace(
      /\b((?:authorization|token|authToken|password|secret|e2eeKeyring|recoveryCode|keyMaterial|deviceTrustSecret)\s*=\s*)[^\s,"'}]+/gi,
      `$1${REDACTED_DEBUG_VALUE}`
    );
}
