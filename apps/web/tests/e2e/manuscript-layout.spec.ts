import { expect, test } from '@playwright/test';

// Exercises the print layout engine directly (the e2e server runs Vite dev,
// so source modules can be imported in the page).
test('lays out manuscript pages without losing, clipping or hanging @cross-browser', async ({
  page
}) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('.app-shell'));

  const sentence =
    'The shutters had been closed for eleven years, and when Marta finally pushed them open the light came in all at once, like water through a broken dam.';
  const cases = [
    {
      preset: 'prose',
      notes: Array.from({ length: 4 }, (_, chapter) => ({
        id: `c${chapter}`,
        title: `Chapter ${chapter + 1}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        body: Array.from({ length: 30 }, (_, index) =>
          index % 9 === 8
            ? '* * *'
            : `${index} Łódź świętość ${sentence.repeat(1 + (index % 4))}`
        ).join('\n')
      }))
    },
    {
      preset: 'poetry',
      notes: [
        {
          id: 'p1',
          title: 'Long poem',
          createdAt: '2026-01-01T00:00:00.000Z',
          body: Array.from({ length: 90 }, (_, index) =>
            index % 5 === 4 ? '' : `   line ${index} ${sentence}`
          ).join('\n')
        }
      ]
    },
    {
      // A "word" longer than a page used to loop forever.
      preset: 'prose',
      notes: [
        {
          id: 'w1',
          title: 'Paste',
          createdAt: '2026-01-01T00:00:00.000Z',
          body: `start ${'x'.repeat(9000)} end`
        }
      ]
    },
    {
      preset: 'poetry',
      notes: [
        {
          id: 'w2',
          title: 'Wide',
          createdAt: '2026-01-01T00:00:00.000Z',
          body: `short\n${'y'.repeat(9000)}\nafter`
        }
      ]
    }
  ];

  for (const testCase of cases) {
    const result = await page.evaluate(async ({ preset, notes }) => {
      const manuscriptModule = '/src/lib/client/manuscript.ts';
      const printModule = '/src/lib/client/manuscript-print.ts';
      const { buildManuscript, DEFAULT_MANUSCRIPT_OPTIONS } = await import(
        /* @vite-ignore */ manuscriptModule
      );
      const { renderManuscriptPages, removeManuscriptPrint } = await import(
        /* @vite-ignore */ printModule
      );
      const manuscript = buildManuscript('Book', notes, {
        ...DEFAULT_MANUSCRIPT_OPTIONS,
        preset,
        header: 'Book'
      });
      const root: HTMLElement = await renderManuscriptPages(manuscript);
      const contents = [...root.querySelectorAll<HTMLElement>('.ms-content')];
      const clipped = contents.filter((content) => {
        const bottom = content.getBoundingClientRect().bottom + 0.5;
        const last = content.lastElementChild;
        return last ? last.getBoundingClientRect().bottom > bottom : false;
      }).length;
      const printed = [
        ...root.querySelectorAll('.ms-content h2, .ms-content p')
      ]
        .map((node) =>
          node.classList.contains('ms-scene-break') ? '' : node.textContent
        )
        .join('');
      const expected = manuscript.sections
        .flatMap(
          (section: { title: string; blocks: Array<{ text?: string }> }) => [
            section.title,
            ...section.blocks.map((block) => block.text ?? '')
          ]
        )
        .join('');
      const pages = root.querySelectorAll('.ms-page').length;
      removeManuscriptPrint();
      return {
        pages,
        clipped,
        sameText: printed.replace(/\s/g, '') === expected.replace(/\s/g, '')
      };
    }, testCase);

    expect(result.pages).toBeGreaterThan(1);
    expect(result.clipped).toBe(0);
    expect(result.sameText).toBe(true);
  }
});
