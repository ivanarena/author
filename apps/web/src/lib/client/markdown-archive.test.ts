import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Note, Notebook } from '@author/schema';
import {
  buildNotesMarkdownArchive,
  createZipBytes,
  formatMarkdownDate,
  parseMarkdownNote,
  parseNotesMarkdownImportFiles,
  type MarkdownImportFile
} from './markdown-archive';

const sampleExportRoot = fileURLToPath(
  new URL(
    '../../../../../to_import/nn-export-195-md-frontmatter-1777555130715',
    import.meta.url
  )
);

describe('Markdown archive import and export', () => {
  it('parses frontmatter notes and strips the generated title heading', () => {
    const parsed = parseMarkdownNote(
      [
        '---',
        'title: "Aurora"',
        'created_at: 15-12-2023 04:35 PM',
        'updated_at: 15-12-2023 04:35 PM',
        'tags: ita',
        '---',
        '',
        '# Aurora',
        '',
        "un'aurora mi stringe"
      ].join('\n'),
      'Aurora.md'
    );

    expect(parsed).toMatchObject({
      title: 'Aurora',
      body: "un'aurora mi stringe",
      sourceNotebookIds: [],
      sourceNotebookNames: [],
      trashedAt: null
    });
    expect(formatMarkdownDate(parsed.createdAt!)).toBe('15-12-2023 04:35 PM');
    expect(parsed.updatedAt).toBe(parsed.createdAt);
  });

  it('reads the real to_import folder as notebooks and notes', async () => {
    const files = await markdownFiles(sampleExportRoot);
    const parsed = await parseNotesMarkdownImportFiles(files);
    const sampleNote = parsed.notes.find((note) => note.title === 'Code ideas');

    expect(parsed.notes).toHaveLength(195);
    expect(parsed.notebooks.map((notebook) => notebook.name).sort()).toEqual([
      'junk',
      'poems',
      'songs'
    ]);
    expect(sampleNote).toMatchObject({
      sourceNotebookNames: ['junk'],
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    });
    expect(sampleNote?.body.startsWith('# Code ideas')).toBe(false);
  });

  it('falls back to folder paths and file names without frontmatter', async () => {
    const parsed = await parseNotesMarkdownImportFiles([
      markdownFile('Export/Ideas/Loose-note.md', 'First line\nsecond'),
      markdownFile('Export/Ideas/Nested/Deep.md', '')
    ]);

    expect(parsed.notebooks.map((notebook) => notebook.name)).toEqual([
      'Ideas',
      'Nested'
    ]);
    expect(parsed.notes).toEqual([
      expect.objectContaining({
        title: 'First line',
        body: 'First line\nsecond',
        sourceNotebookNames: ['Ideas']
      }),
      expect.objectContaining({
        title: 'Deep',
        body: '',
        sourceNotebookNames: ['Ideas', 'Nested']
      })
    ]);
  });

  it('builds Markdown files with frontmatter, notebook folders, and unique names', () => {
    const exportedAt = '2026-04-30T10:00:00.000Z';
    const archive = buildNotesMarkdownArchive(
      [
        note({
          id: 'note-1',
          title: 'Aurora',
          body: "un'aurora mi stringe",
          notebookIds: ['poems'],
          notebookId: 'poems'
        }),
        note({
          id: 'note-2',
          title: 'Aurora',
          body: '# Aurora\n\nalready has a heading',
          notebookIds: ['poems'],
          notebookId: 'poems',
          updatedAt: '2026-04-29T10:00:00.000Z'
        }),
        note({
          id: 'note-3',
          title: 'Root / note',
          body: 'unfiled body',
          notebookIds: [],
          notebookId: null,
          updatedAt: '2026-04-28T10:00:00.000Z'
        })
      ],
      [notebook({ id: 'poems', name: 'poems' })],
      exportedAt
    );

    expect(archive.rootName).toBe('author-notes-2026-04-30-md-frontmatter');
    expect(archive.files.map((file) => file.path)).toEqual([
      'poems/Aurora.md',
      'poems/Aurora-2.md',
      'Root---note.md'
    ]);
    expect(archive.files[0].content).toContain('title: "Aurora"');
    expect(archive.files[0].content).toContain('\n# Aurora\n\n');
    expect(archive.files[1].content.match(/^# Aurora/gm)).toHaveLength(1);
  });

  it('creates a readable zip archive containing Markdown paths', () => {
    const archive = buildNotesMarkdownArchive(
      [
        note({
          id: 'note-1',
          title: 'Aurora',
          body: 'body',
          notebookIds: ['poems'],
          notebookId: 'poems'
        })
      ],
      [notebook({ id: 'poems', name: 'poems' })],
      '2026-04-30T10:00:00.000Z'
    );
    const bytes = createZipBytes(archive, '2026-04-30T10:00:00.000Z');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoded = new TextDecoder().decode(bytes);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 14, true)).toBe(1);
    expect(decoded).toContain(
      'author-notes-2026-04-30-md-frontmatter/poems/Aurora.md'
    );
  });
});

async function markdownFiles(root: string): Promise<MarkdownImportFile[]> {
  const entries = await readMarkdownFiles(root);
  return Promise.all(
    entries.map(async (path) => {
      const content = await readFile(path, 'utf8');
      const relativePath = path.slice(root.length + 1).replaceAll('\\', '/');
      return markdownFile(`nn-export/${relativePath}`, content);
    })
  );
}

async function readMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory()
        ? readMarkdownFiles(path)
        : entry.name.endsWith('.md')
          ? [path]
          : [];
    })
  );
  return paths.flat().sort();
}

function markdownFile(path: string, content: string): MarkdownImportFile {
  return {
    name: path.split('/').at(-1) ?? path,
    webkitRelativePath: path,
    text: async () => content
  };
}

function notebook(overrides: Partial<Notebook>): Notebook {
  return {
    id: 'notebook-1',
    name: 'Notebook',
    createdAt: '2026-04-30T10:00:00.000Z',
    updatedAt: '2026-04-30T10:00:00.000Z',
    deletedAt: null,
    deviceId: 'device-1',
    version: 1,
    syncStatus: 'synced',
    ...overrides
  };
}

function note(overrides: Partial<Note>): Note {
  return {
    id: 'note-1',
    title: 'Note',
    body: 'Body',
    notebookIds: [],
    notebookId: null,
    createdAt: '2026-04-30T10:00:00.000Z',
    updatedAt: '2026-04-30T10:00:00.000Z',
    deletedAt: null,
    trashedAt: null,
    deviceId: 'device-1',
    version: 1,
    syncStatus: 'synced',
    ...overrides
  };
}
