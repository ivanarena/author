import type { Note, Notebook } from '@author/schema';
import { parseDateValue, type ParsedImportPayload } from './archive-parser';
import { deriveTitle, noteDisplayTitle, noteNotebookIds } from './note-utils';

export interface MarkdownImportFile {
  name: string;
  webkitRelativePath?: string;
  text: () => Promise<string>;
}

export interface MarkdownExportFile {
  path: string;
  content: string;
}

export interface MarkdownExportArchive {
  rootName: string;
  files: MarkdownExportFile[];
}

const MARKDOWN_EXTENSION = /\.md$/i;
const FRONTMATTER_DELIMITER = '---';
const encoder = new TextEncoder();

export async function parseNotesMarkdownImportFiles(
  files: Iterable<MarkdownImportFile>
): Promise<ParsedImportPayload> {
  const markdownFiles = [...files].filter((file) =>
    MARKDOWN_EXTENSION.test(file.name)
  );
  const relativePaths = markdownFiles.map((file) => filePath(file));
  const strippedPaths = stripCommonLeadingDirectories(relativePaths);
  const notebookNames = [
    ...new Set(strippedPaths.flatMap((path) => parentSegments(path)))
  ];

  const notes = await Promise.all(
    markdownFiles.map(async (file, index) => {
      const path = strippedPaths[index] ?? file.name;
      const parsed = parseMarkdownNote(await file.text(), file.name);

      return {
        ...parsed,
        sourceNotebookIds: [],
        sourceNotebookNames: parentSegments(path),
        trashedAt: null
      };
    })
  );

  return {
    notebooks: notebookNames.map((name) => ({
      sourceId: null,
      name,
      createdAt: null,
      updatedAt: null
    })),
    notes
  };
}

export function parseMarkdownNote(
  content: string,
  fallbackFileName = 'Untitled.md'
): ParsedImportPayload['notes'][number] {
  const { frontmatter, body } = splitFrontmatter(content);
  const title =
    frontmatterString(frontmatter, 'title') ||
    deriveTitle(body) ||
    titleFromFileName(fallbackFileName);

  return {
    title,
    body: stripGeneratedHeading(body, title),
    sourceNotebookIds: [],
    sourceNotebookNames: [],
    createdAt: parseMarkdownDate(frontmatterString(frontmatter, 'created_at')),
    updatedAt: parseMarkdownDate(frontmatterString(frontmatter, 'updated_at')),
    trashedAt: null
  };
}

export function buildNotesMarkdownArchive(
  notes: Note[],
  notebooks: Notebook[],
  exportedAt: string
): MarkdownExportArchive {
  const activeNotebooks = notebooks.filter((notebook) => !notebook.deletedAt);
  const notebookNameById = new Map(
    activeNotebooks.map((notebook) => [notebook.id, notebook.name])
  );
  const usedPaths = new Set<string>();
  const files = notes
    .filter((note) => !note.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((note) => {
      const title = noteDisplayTitle(note);
      const notebookName = noteNotebookIds(note)
        .map((id) => notebookNameById.get(id))
        .find((name): name is string => Boolean(name));
      const path = uniquePath(
        [
          ...(notebookName ? [safePathSegment(notebookName)] : []),
          `${safePathSegment(title)}.md`
        ].join('/'),
        usedPaths
      );

      return {
        path,
        content: markdownNoteContent(note, title)
      };
    });

  return {
    rootName: `author-${exportedAt.slice(0, 10)}-md-frontmatter`,
    files
  };
}

export function markdownNoteContent(note: Note, title: string): string {
  const body = bodyWithHeading(note.body, title);

  return [
    FRONTMATTER_DELIMITER,
    `title: "${escapeYamlString(title)}"`,
    `created_at: ${formatMarkdownDate(note.createdAt)}`,
    `updated_at: ${formatMarkdownDate(note.updatedAt)}`,
    'tags: ',
    FRONTMATTER_DELIMITER,
    '',
    body.trimEnd(),
    ''
  ].join('\n');
}

export function createZipBlob(
  archive: MarkdownExportArchive,
  exportedAt: string
): Blob {
  const bytes = createZipBytes(archive, exportedAt);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], {
    type: 'application/zip'
  });
}

export function createZipBytes(
  archive: MarkdownExportArchive,
  exportedAt: string
): Uint8Array {
  const fileDate = new Date(exportedAt);
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const file of archive.files) {
    const path = `${archive.rootName}/${file.path}`;
    const nameBytes = encoder.encode(path);
    const contentBytes = encoder.encode(file.content);
    const checksum = crc32(contentBytes);
    const localHeader = zipLocalFileHeader(
      nameBytes,
      contentBytes.length,
      checksum,
      fileDate
    );
    chunks.push(localHeader, nameBytes, contentBytes);
    centralDirectory.push(
      zipCentralDirectoryHeader(
        nameBytes,
        contentBytes.length,
        checksum,
        fileDate,
        offset
      ),
      nameBytes
    );
    offset += localHeader.length + nameBytes.length + contentBytes.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralDirectory.reduce(
    (size, chunk) => size + chunk.length,
    0
  );
  chunks.push(...centralDirectory);
  chunks.push(
    zipEndOfCentralDirectory(
      archive.files.length,
      centralDirectorySize,
      centralDirectoryOffset
    )
  );

  const totalLength = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

export function formatMarkdownDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  return `${day}-${month}-${year} ${pad(hour12)}:${pad(date.getMinutes())} ${suffix}`;
}

function splitFrontmatter(content: string): {
  frontmatter: Map<string, string>;
  body: string;
} {
  const normalized = content.replaceAll('\r\n', '\n');
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return { frontmatter: new Map(), body: normalized };
  }

  const closingIndex = normalized.indexOf(
    `\n${FRONTMATTER_DELIMITER}\n`,
    FRONTMATTER_DELIMITER.length + 1
  );
  if (closingIndex === -1) return { frontmatter: new Map(), body: normalized };

  const rawFrontmatter = normalized.slice(
    FRONTMATTER_DELIMITER.length + 1,
    closingIndex
  );
  const body = normalized.slice(
    closingIndex + FRONTMATTER_DELIMITER.length + 2
  );

  return { frontmatter: parseSimpleYaml(rawFrontmatter), body };
}

function parseSimpleYaml(source: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of source.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    values.set(match[1], unquoteYamlString(match[2].trim()));
  }

  return values;
}

function frontmatterString(
  frontmatter: Map<string, string>,
  key: string
): string | null {
  const value = frontmatter.get(key);
  return value?.trim() ? value : null;
}

function unquoteYamlString(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) return value;
  const inner = value.slice(1, -1);
  return quote === '"'
    ? inner.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
    : inner.replaceAll("''", "'");
}

function parseMarkdownDate(value: string | null): string | null {
  if (!value) return null;
  const match =
    /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(
      value.trim()
    );

  if (match) {
    const [, day, month, year, hour, minute, suffix] = match;
    let hour24 = Number(hour) % 12;
    if (suffix.toUpperCase() === 'PM') hour24 += 12;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      hour24,
      Number(minute)
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return parseDateValue(value);
}

function stripGeneratedHeading(body: string, title: string): string {
  const escapedTitle = escapeRegExp(title.trim());
  if (!escapedTitle) return body.trim();
  return body
    .replace(new RegExp(`^\\s*#\\s+${escapedTitle}\\s*\\n+`, 'i'), '')
    .trim();
}

function bodyWithHeading(body: string, title: string): string {
  const trimmed = body.trim();
  if (!title.trim()) return trimmed;
  if (
    new RegExp(`^#\\s+${escapeRegExp(title.trim())}\\s*(?:\\n|$)`, 'i').test(
      trimmed
    )
  ) {
    return trimmed;
  }
  return trimmed ? `# ${title}\n\n${trimmed}` : `# ${title}`;
}

function filePath(file: MarkdownImportFile): string {
  return (file.webkitRelativePath || file.name).replaceAll('\\', '/');
}

function stripCommonLeadingDirectories(paths: string[]): string[] {
  if (!paths.length) return [];
  const splitPaths = paths.map((path) => path.split('/').filter(Boolean));
  let commonCount = 0;
  const maxCommonCount = Math.max(
    0,
    Math.min(...splitPaths.map((parts) => parts.length)) - 1
  );

  while (
    commonCount < maxCommonCount &&
    splitPaths.every(
      (parts) => parts[commonCount] === splitPaths[0][commonCount]
    )
  ) {
    commonCount += 1;
  }

  const commonDirectories = splitPaths[0].slice(0, commonCount);
  const exportRootIndex = commonDirectories.findLastIndex(isArchiveRootName);
  const stripCount =
    exportRootIndex >= 0 ? exportRootIndex + 1 : Math.min(commonCount, 1);

  if (stripCount === 0) return paths;
  return splitPaths.map((parts) => parts.slice(stripCount).join('/'));
}

function parentSegments(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(0, -1);
}

function titleFromFileName(fileName: string): string {
  const baseName = fileName.replace(MARKDOWN_EXTENSION, '');
  return baseName.replaceAll('-', ' ').trim() || 'Untitled';
}

function safePathSegment(value: string): string {
  const fallback = value.trim() || 'Untitled';
  const safe = fallback
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^-+|-+$/g, '');
  return safe || 'Untitled';
}

function isArchiveRootName(value: string): boolean {
  return (
    value.startsWith('nn-export') ||
    /^author-\d{4}-\d{2}-\d{2}-md-frontmatter$/.test(value) ||
    /^author-notes-\d{4}-\d{2}-\d{2}-md-frontmatter$/.test(value)
  );
}

function uniquePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const extensionIndex = path.lastIndexOf('.');
  const stem = extensionIndex === -1 ? path : path.slice(0, extensionIndex);
  const extension = extensionIndex === -1 ? '' : path.slice(extensionIndex);
  let counter = 2;
  let candidate = `${stem}-${counter}${extension}`;
  while (usedPaths.has(candidate)) {
    counter += 1;
    candidate = `${stem}-${counter}${extension}`;
  }
  usedPaths.add(candidate);
  return candidate;
}

function escapeYamlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function zipLocalFileHeader(
  nameBytes: Uint8Array,
  size: number,
  checksum: number,
  date: Date
): Uint8Array {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  writeDosDateTime(view, 10, date);
  view.setUint32(14, checksum, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  return header;
}

function zipCentralDirectoryHeader(
  nameBytes: Uint8Array,
  size: number,
  checksum: number,
  date: Date,
  offset: number
): Uint8Array {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  writeDosDateTime(view, 12, date);
  view.setUint32(16, checksum, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  return header;
}

function zipEndOfCentralDirectory(
  fileCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number
): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function writeDosDateTime(view: DataView, offset: number, date: Date): void {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const time =
    (safeDate.getHours() << 11) |
    (safeDate.getMinutes() << 5) |
    Math.floor(safeDate.getSeconds() / 2);
  const dosDate =
    ((safeDate.getFullYear() - 1980) << 9) |
    ((safeDate.getMonth() + 1) << 5) |
    safeDate.getDate();
  view.setUint16(offset, time, true);
  view.setUint16(offset + 2, dosDate, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
