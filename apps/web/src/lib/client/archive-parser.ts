export interface ParsedImportNotebook {
  sourceId: string | null;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ParsedImportNote {
  title: string;
  body: string;
  sourceNotebookIds: string[];
  sourceNotebookNames: string[];
  createdAt: string | null;
  updatedAt: string | null;
  trashedAt: string | null;
}

export interface ParsedImportPayload {
  notebooks: ParsedImportNotebook[];
  notes: ParsedImportNote[];
}

export function parseDateValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return dateFromNumber(value);
  }

  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^\d+$/.test(trimmed)) {
    return dateFromNumber(numeric);
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateFromNumber(value: number): string | null {
  let timestamp = value;
  if (value > 1_000_000_000_000_000) {
    timestamp = value / 1000;
  } else if (value < 10_000_000_000) {
    timestamp = value * 1000;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
