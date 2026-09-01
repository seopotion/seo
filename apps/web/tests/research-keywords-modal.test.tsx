import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { KeywordMetric } from '../app/[locale]/(authenticated)/(product)/content-planner/types';
import messages from '../messages/en.json';

/**
 * The other half of the chained-dialog pair. Same approach as
 * `choose-keyword-modal.test.tsx`: the real component, the real `en.json`, and a
 * real QueryClient — only the HTTP client and next-intl's navigation `Link` are
 * stubbed.
 *
 * This component drives two mutations (research, then per-keyword add) and,
 * unlike the chooser, reads `response.ok` rather than the status code.
 */

const researchPost = vi.hoisted(() => vi.fn());
const addPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: {
    api: {
      v0: {
        keywords: {
          research: { $post: researchPost },
          candidates: { $post: addPost },
        },
      },
    },
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { ResearchKeywordsModal } = await import(
  '../app/[locale]/(authenticated)/(product)/content-planner/_components/ResearchKeywordsModal'
);

const ORGANIZATION_ID = 'org-1';

function metric(overrides: Partial<KeywordMetric> = {}): KeywordMetric {
  return {
    competition: 0.4,
    cpc: 1.5,
    difficulty: 30,
    intent: 'informational',
    keyword: 'content marketing',
    search_volume: 1200,
    trend: 0,
    ...overrides,
  };
}

/** This component branches on `response.ok`, not on the status code. */
function apiResponse(status: number, body?: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function researchResult(seed: KeywordMetric, similar: KeywordMetric[] = []) {
  return apiResponse(200, { seed, similar });
}

type Props = Parameters<typeof ResearchKeywordsModal>[0];

function renderModal(overrides: Partial<Props> = {}) {
  const props: Props = {
    canResearch: true,
    onClose: vi.fn(),
    onUnauthorized: vi.fn(),
    open: true,
    organizationId: ORGANIZATION_ID,
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <ResearchKeywordsModal {...props} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

  return { ...props, invalidateQueries, user: userEvent.setup() };
}

function dialog() {
  return screen.getByRole('dialog');
}

/** Results render as a desktop table and a mobile list at once — scope to one. */
function desktop() {
  return within(screen.getByRole('table'));
}

function seedInput() {
  return screen.getByLabelText('Keyword or topic');
}

function searchButton() {
  return screen.getByRole('button', { name: 'Search' });
}

function isDisabled(element: HTMLElement) {
  return element.hasAttribute('disabled');
}

/** Run a successful search so the results table is on screen. */
async function search(user: ReturnType<typeof userEvent.setup>, seed = 'content marketing') {
  await user.type(seedInput(), seed);
  await user.click(searchButton());
  await waitFor(() => {
    expect(screen.getByRole('table')).toBeTruthy();
  });
}

beforeEach(() => {
  researchPost.mockReset();
  addPost.mockReset();
});

describe('initial render', () => {
  test('focuses the seed input, which carries the modal initial-focus marker', async () => {
    renderModal();

    // Integration proof of the `data-modal-initial-focus` contract that
    // modal.test.tsx pins in isolation.
    await waitFor(() => {
      expect(document.activeElement).toBe(seedInput());
    });
    expect(seedInput().hasAttribute('data-modal-initial-focus')).toBe(true);
  });

  test('titles the dialog and prompts for a search', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: 'Research Keywords' })).toBe(dialog());
    expect(
      screen.getByText('Search for a keyword or topic to see related opportunities.'),
    ).toBeTruthy();
  });

  test('counts characters against the seed limit as you type', async () => {
    const { user } = renderModal();
    expect(screen.getByText('0/200')).toBeTruthy();

    await user.type(seedInput(), 'seo');

    expect(screen.getByText('3/200')).toBeTruthy();
  });
});

describe('upgrade gate', () => {
  test('replaces the whole body with the upgrade panel when research is not allowed', () => {
    renderModal({ canResearch: false });

    expect(screen.getByText('Keyword research is a paid feature')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upgrade' }).getAttribute('href')).toBe('/billing');
    expect(screen.queryByLabelText('Keyword or topic')).toBeNull();
  });
});

describe('seed validation', () => {
  test('refuses an empty seed without calling the API', async () => {
    const { user } = renderModal();

    await user.click(searchButton());

    expect(screen.getByRole('alert').textContent).toBe('Enter a keyword or topic.');
    expect(researchPost).not.toHaveBeenCalled();
  });

  test('treats a whitespace-only seed as empty', async () => {
    const { user } = renderModal();

    await user.type(seedInput(), '   ');
    await user.click(searchButton());

    expect(screen.getByRole('alert').textContent).toBe('Enter a keyword or topic.');
    expect(researchPost).not.toHaveBeenCalled();
  });

  test('refuses a seed over the length limit', async () => {
    const { user } = renderModal();

    // The input's maxLength normally makes this unreachable by typing, so drive
    // the change directly to exercise the guard behind it.
    fireEvent.change(seedInput(), { target: { value: 'a'.repeat(201) } });
    await user.click(searchButton());

    expect(screen.getByRole('alert').textContent).toBe(
      'Keep the search to 200 characters or fewer.',
    );
    expect(researchPost).not.toHaveBeenCalled();
  });

  test('trims the seed before sending it', async () => {
    researchPost.mockResolvedValue(researchResult(metric()));
    const { user } = renderModal();

    await user.type(seedInput(), '  content marketing  ');
    await user.click(searchButton());

    await waitFor(() => {
      expect(researchPost).toHaveBeenCalledWith({
        json: { org_id: ORGANIZATION_ID, seed: 'content marketing' },
      });
    });
    // The visible field is normalized too, not just the payload.
    expect((seedInput() as HTMLInputElement).value).toBe('content marketing');
  });

  test('clears a validation error as soon as the seed is edited', async () => {
    const { user } = renderModal();
    await user.click(searchButton());
    expect(screen.getByRole('alert')).toBeTruthy();

    await user.type(seedInput(), 's');

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('searching', () => {
  test('renders the seed and its related keywords, seed first', async () => {
    researchPost.mockResolvedValue(
      researchResult(metric({ keyword: 'content marketing' }), [
        metric({ keyword: 'content strategy', difficulty: 45, search_volume: 800 }),
      ]),
    );
    const { user } = renderModal();

    await search(user);

    expect(screen.getByText('Research results')).toBeTruthy();
    expect(screen.getByText('2 results')).toBeTruthy();
    const rows = desktop().getAllByRole('row').slice(1); // drop the header row
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'content marketing',
      'content strategy',
    ]);
  });

  test('uses the singular result label for one result', async () => {
    researchPost.mockResolvedValue(researchResult(metric()));
    const { user } = renderModal();

    await search(user);

    expect(screen.getByText('1 result')).toBeTruthy();
  });

  test('shows metrics and an em dash where they are missing', async () => {
    researchPost.mockResolvedValue(
      researchResult(metric({ difficulty: null, intent: null, search_volume: null })),
    );
    const { user } = renderModal();

    await search(user);

    const row = desktop().getByRole('row', { name: /content marketing/ });
    expect(within(row).getAllByText('—')).toHaveLength(3);
  });

  test('disables the form and announces progress while searching', async () => {
    let settle: (value: unknown) => void = () => {};
    researchPost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { user } = renderModal();

    await user.type(seedInput(), 'seo');
    await user.click(searchButton());

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Researching keywords...');
    });
    expect(isDisabled(seedInput())).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Searching...' }))).toBe(true);

    settle(researchResult(metric()));
  });

  test.each([
    [400, 'Enter a valid keyword or topic.'],
    [403, 'You do not have access to research keywords for this organization.'],
    [404, 'This organization is no longer available.'],
    [502, 'The keyword data provider is unavailable right now. Try again later.'],
    [500, 'Keyword research is unavailable right now. Try again.'],
  ])('a %i explains what went wrong', async (status, message) => {
    researchPost.mockResolvedValue(apiResponse(status));
    const { user } = renderModal();

    await user.type(seedInput(), 'seo');
    await user.click(searchButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(message);
    });
  });

  test('a 401 escalates to onUnauthorized and shows no error', async () => {
    researchPost.mockResolvedValue(apiResponse(401));
    const { onUnauthorized, user } = renderModal();

    await user.type(seedInput(), 'seo');
    await user.click(searchButton());

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a 402 swaps the body for the upgrade panel', async () => {
    researchPost.mockResolvedValue(apiResponse(402));
    const { user } = renderModal();

    await user.type(seedInput(), 'seo');
    await user.click(searchButton());

    await waitFor(() => {
      expect(screen.getByText('Keyword research is a paid feature')).toBeTruthy();
    });
    expect(screen.queryByLabelText('Keyword or topic')).toBeNull();
  });

  test('a thrown request reports the generic error', async () => {
    researchPost.mockRejectedValue(new Error('offline'));
    const { user } = renderModal();

    await user.type(seedInput(), 'seo');
    await user.click(searchButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Keyword research is unavailable right now. Try again.',
      );
    });
  });
});

describe('adding a result to the pool', () => {
  async function searchThenAdd(keyword = 'content marketing') {
    researchPost.mockResolvedValue(
      researchResult(metric({ keyword }), [metric({ keyword: 'content strategy' })]),
    );
    const rendered = renderModal();
    await search(rendered.user);
    return rendered;
  }

  test('posts the keyword, marks it added, and refreshes the candidate pool', async () => {
    addPost.mockResolvedValue(apiResponse(200, { added: 1 }));
    const { invalidateQueries, user } = await searchThenAdd();

    const row = desktop().getByRole('row', { name: /content marketing/ });
    await user.click(within(row).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(within(row).getByRole('button', { name: 'Added' })).toBeTruthy();
    });
    expect(addPost).toHaveBeenCalledWith({
      json: {
        keywords: [expect.objectContaining({ keyword: 'content marketing' })],
        org_id: ORGANIZATION_ID,
      },
    });
    expect(isDisabled(within(row).getByRole('button', { name: 'Added' }))).toBe(true);
    await waitFor(() => {
      expect(
        invalidateQueries.mock.calls.some(
          (call) =>
            (call[0] as { queryKey: readonly string[] }).queryKey.at(-1) === 'candidate-pool',
        ),
      ).toBe(true);
    });
  });

  test('reports a keyword the pool already had as already existing', async () => {
    addPost.mockResolvedValue(apiResponse(200, { added: 0 }));
    const { user } = await searchThenAdd();

    const row = desktop().getByRole('row', { name: /content marketing/ });
    await user.click(within(row).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(within(row).getByRole('button', { name: 'Already exists' })).toBeTruthy();
    });
  });

  test('shows a pending label on the row being added', async () => {
    let settle: (value: unknown) => void = () => {};
    addPost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { user } = await searchThenAdd();

    const row = desktop().getByRole('row', { name: /content marketing/ });
    await user.click(within(row).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(within(row).getByRole('button', { name: 'Adding...' })).toBeTruthy();
    });

    settle(apiResponse(200, { added: 1 }));
  });

  test('reports an add failure against the row that failed, leaving others alone', async () => {
    addPost.mockResolvedValue(apiResponse(403));
    const { user } = await searchThenAdd();

    const failing = desktop().getByRole('row', { name: /content marketing/ });
    await user.click(within(failing).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(within(failing).getByRole('alert').textContent).toBe(
        'You do not have access to add this keyword.',
      );
    });
    // The sibling row is untouched and still addable.
    const other = desktop().getByRole('row', { name: /content strategy/ });
    expect(within(other).queryByRole('alert')).toBeNull();
    expect(isDisabled(within(other).getByRole('button', { name: 'Add' }))).toBe(false);
  });

  test('a failed add can be retried', async () => {
    addPost.mockResolvedValueOnce(apiResponse(500));
    const { user } = await searchThenAdd();
    const row = desktop().getByRole('row', { name: /content marketing/ });
    await user.click(within(row).getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(within(row).getByRole('alert')).toBeTruthy();
    });

    addPost.mockResolvedValueOnce(apiResponse(200, { added: 1 }));
    await user.click(within(row).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(within(row).getByRole('button', { name: 'Added' })).toBeTruthy();
    });
    expect(within(row).queryByRole('alert')).toBeNull();
  });

  test('a 401 on add escalates without marking the row', async () => {
    addPost.mockResolvedValue(apiResponse(401));
    const { onUnauthorized, user } = await searchThenAdd();

    const row = desktop().getByRole('row', { name: /content marketing/ });
    await user.click(within(row).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
    expect(within(row).queryByRole('alert')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  test('a 402 on add swaps the body for the upgrade panel', async () => {
    addPost.mockResolvedValue(apiResponse(402));
    const { user } = await searchThenAdd();

    await user.click(
      within(desktop().getByRole('row', { name: /content marketing/ })).getByRole('button', {
        name: 'Add',
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('Keyword research is a paid feature')).toBeTruthy();
    });
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('closing', () => {
  test('the header close button closes and clears the search', async () => {
    researchPost.mockResolvedValue(researchResult(metric()));
    const { onClose, user } = renderModal();
    await search(user);

    // The backdrop shares this accessible name but sits outside the dialog.
    await user.click(within(dialog()).getByRole('button', { name: 'Close keyword research' }));

    expect(onClose).toHaveBeenCalledOnce();
    // resetState runs on close, so a reopen starts from the empty state.
    expect(screen.queryByRole('table')).toBeNull();
    expect((seedInput() as HTMLInputElement).value).toBe('');
    expect(
      screen.getByText('Search for a keyword or topic to see related opportunities.'),
    ).toBeTruthy();
  });

  test('Escape closes even mid-search, unlike the keyword chooser', async () => {
    let settle: (value: unknown) => void = () => {};
    researchPost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { onClose, user } = renderModal();
    await user.type(seedInput(), 'seo');
    await user.click(searchButton());
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
    });

    await user.keyboard('{Escape}');

    // ChooseKeywordModal refuses to close while its request is in flight; this
    // one has no such guard — it resets and closes immediately.
    expect(onClose).toHaveBeenCalledOnce();

    settle(researchResult(metric()));
  });

  test('a search that lands after close is discarded', async () => {
    let settle: (value: unknown) => void = () => {};
    researchPost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { user } = renderModal();
    await user.type(seedInput(), 'seo');
    await user.click(searchButton());
    await user.click(within(dialog()).getByRole('button', { name: 'Close keyword research' }));

    settle(researchResult(metric()));

    // The sessionRef bump on close means the late response must not repopulate
    // the results of a dialog the user already dismissed.
    await waitFor(() => {
      expect(
        screen.getByText('Search for a keyword or topic to see related opportunities.'),
      ).toBeTruthy();
    });
    expect(screen.queryByRole('table')).toBeNull();
  });
});
