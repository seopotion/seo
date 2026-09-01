import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  CandidateKeywordResponse,
  CandidateScheduleError,
} from '../app/[locale]/(authenticated)/(product)/content-planner/types';
import messages from '../messages/en.json';

/**
 * Integration test at the real call site: the actual `ChooseKeywordModal`, the
 * real `en.json` messages, and a real react-query client. Only the two genuine
 * boundaries are stubbed — the HTTP client and next-intl's navigation `Link`,
 * which needs a Next router context that does not exist under jsdom.
 *
 * Using the real provider and the real QueryClient rather than mocking
 * `useTranslations` / `useMutation` is deliberate: it means the assertions run
 * against the strings users actually see and the cache behaviour that actually
 * ships, and a missing message key fails the test instead of passing silently.
 */

const schedulePost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: {
    api: {
      v0: {
        keywords: {
          candidates: { ':candidate_id': { schedule: { $post: schedulePost } } },
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

const { ChooseKeywordModal } = await import(
  '../app/[locale]/(authenticated)/(product)/content-planner/_components/ChooseKeywordModal'
);

const DATE_KEY = '2026-09-10';
const ORGANIZATION_ID = 'org-1';

function candidate(overrides: Partial<CandidateKeywordResponse> = {}): CandidateKeywordResponse {
  return {
    difficulty: 30,
    id: 'cand-1',
    intent: 'informational',
    keyword: 'seo tools',
    opportunity_score: 70,
    schedulable: true,
    search_volume: 1200,
    status: 'candidate',
    ...overrides,
  };
}

/** Responses the component reads as `{ status, json() }`. */
function apiResponse(status: number, body?: unknown) {
  return { status, json: async () => body };
}

type Props = Parameters<typeof ChooseKeywordModal>[0];

function renderModal(overrides: Partial<Props> = {}) {
  const props: Props = {
    canSchedule: true,
    candidates: [candidate()],
    dateKey: DATE_KEY,
    hasMore: false,
    loadError: false,
    loading: false,
    loadingMore: false,
    onClose: vi.fn(),
    onLoadMore: vi.fn(),
    onOpenResearch: vi.fn(),
    onRetry: vi.fn(),
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
        <ChooseKeywordModal {...props} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

  return { ...props, invalidateQueries, user: userEvent.setup() };
}

/** The dialog element — note the backdrop close button sits outside it. */
function dialog() {
  return screen.getByRole('dialog');
}

/**
 * The component renders a desktop table and a mobile list at the same time and
 * hides one with Tailwind, so every candidate control exists twice in the DOM.
 * Scope to the table to address exactly one.
 */
function desktop() {
  return within(screen.getByRole('table'));
}

/** Invalidation assertions read better as the tail of the query key. */
function invalidatedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: readonly string[] }).queryKey.at(-1));
}

/** `@testing-library/jest-dom` is not installed, so check the attribute directly. */
function isDisabled(element: HTMLElement) {
  return element.hasAttribute('disabled');
}

beforeEach(() => {
  schedulePost.mockReset();
});

describe('rendering', () => {
  test('titles the dialog with the formatted date and describes the task', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: 'Choose a keyword for September 10, 2026' })).toBe(
      dialog(),
    );
    expect(
      screen.getByText('Choose an available target keyword for this calendar date.'),
    ).toBeTruthy();
  });

  test('renders each candidate and its metrics in the desktop table', () => {
    renderModal({
      candidates: [candidate({ difficulty: 30, opportunity_score: 70, search_volume: 1200 })],
    });

    const row = desktop().getByRole('row', { name: /seo tools/ });
    expect(within(row).getByText('seo tools')).toBeTruthy();
    expect(within(row).getByText('30')).toBeTruthy();
    expect(within(row).getByText('1,200')).toBeTruthy();
    expect(within(row).getByText('70')).toBeTruthy();
    expect(within(row).getByText('Informational')).toBeTruthy();
  });

  test('renders a mobile list alongside the desktop table', () => {
    renderModal();

    // Both layouts are always mounted; CSS decides which is visible. A test that
    // forgets this gets "found multiple elements" instead of a useful failure.
    expect(screen.getAllByRole('button', { name: 'Schedule' })).toHaveLength(2);
    expect(within(screen.getByRole('list')).getByText('seo tools')).toBeTruthy();
  });

  test('shows an em dash for missing metrics', () => {
    renderModal({
      candidates: [
        candidate({ difficulty: null, intent: null, opportunity_score: null, search_volume: null }),
      ],
    });

    const row = desktop().getByRole('row', { name: /seo tools/ });
    expect(within(row).getAllByText('—')).toHaveLength(4);
  });

  test('shows the loading state while candidates are being fetched', () => {
    renderModal({ candidates: [], loading: true });

    expect(screen.getByRole('status').textContent).toContain(
      'Loading available target keywords...',
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('disables scheduling for a candidate that is missing metrics', () => {
    renderModal({ candidates: [candidate({ schedulable: false })] });

    expect(isDisabled(desktop().getByRole('button', { name: 'Schedule' }))).toBe(true);
    expect(desktop().getByText('Required volume or difficulty metrics are missing.')).toBeTruthy();
  });
});

describe('upgrade gate', () => {
  test('replaces the body with the upgrade panel when the plan cannot schedule', () => {
    renderModal({ canSchedule: false });

    expect(screen.getByText('Keyword scheduling is a paid feature')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upgrade' }).getAttribute('href')).toBe('/billing');
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('the upgrade panel is not an error banner', () => {
    renderModal({ canSchedule: false });

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('empty state', () => {
  test('offers keyword research and hands off through onOpenResearch', async () => {
    const { onOpenResearch, onClose, user } = renderModal({ candidates: [] });

    expect(screen.getByText('No available target keywords')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Research Keywords' }));

    // This is the chooser half of the chained-dialog handoff: the chooser asks
    // the page to open research, and does *not* close itself via onClose.
    expect(onOpenResearch).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('load failures and paging', () => {
  test('shows a retry alert when candidates failed to load', async () => {
    const { onRetry, user } = renderModal({ candidates: [], loadError: true });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'Available target keywords could not be loaded. Try again.',
    );
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('load more is offered only when there is another page', async () => {
    const { onLoadMore, user } = renderModal({ hasMore: true });

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  test('load more is hidden when there is no next page', () => {
    renderModal({ hasMore: false });

    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  test('the load more control is disabled while the next page is in flight', () => {
    renderModal({ hasMore: true, loadingMore: true });

    expect(isDisabled(screen.getByRole('button', { name: 'Loading...' }))).toBe(true);
  });
});

describe('scheduling a candidate', () => {
  test('posts the candidate and date, refreshes both caches, and closes', async () => {
    schedulePost.mockResolvedValue(apiResponse(200));
    const { onClose, invalidateQueries, user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(schedulePost).toHaveBeenCalledWith({
      param: { candidate_id: 'cand-1' },
      json: { scheduled_date: DATE_KEY },
    });
    expect(invalidatedKeys(invalidateQueries)).toEqual(
      expect.arrayContaining(['candidate-pool', 'planner']),
    );
  });

  test('treats 201 as success too', async () => {
    schedulePost.mockResolvedValue(apiResponse(201));
    const { onClose, user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  test('a 401 escalates to onUnauthorized and shows no error banner', async () => {
    schedulePost.mockResolvedValue(apiResponse(401));
    const { onUnauthorized, onClose, user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a 402 swaps the body for the upgrade panel rather than an error', async () => {
    schedulePost.mockResolvedValue(apiResponse(402));
    const { onClose, user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(screen.getByText('Keyword scheduling is a paid feature')).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  test.each([
    ['date_occupied', 'This date was just taken. The planner was refreshed.', ['planner']],
    [
      'keyword_already_scheduled',
      'This keyword is already on the content plan. Available keywords and the planner were refreshed.',
      ['candidate-pool', 'planner'],
    ],
    [
      'candidate_not_schedulable',
      'This target keyword is no longer available to schedule. Available keywords were refreshed.',
      ['candidate-pool'],
    ],
  ] as [
    CandidateScheduleError,
    string,
    string[],
  ][])('a 409 %s explains itself and refreshes the caches it invalidated', async (error, message, expectedKeys) => {
    schedulePost.mockResolvedValue(apiResponse(409, { error }));
    const { onClose, invalidateQueries, user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(message);
    });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(invalidatedKeys(invalidateQueries)).toEqual(expect.arrayContaining(expectedKeys));
    });
  });

  test('a 400 reports the date as invalid', async () => {
    schedulePost.mockResolvedValue(apiResponse(400));
    const { user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('This calendar date is no longer valid.');
    });
  });

  test('an unrecognised status falls back to the generic message', async () => {
    schedulePost.mockResolvedValue(apiResponse(500));
    const { user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'This keyword could not be scheduled. Try again.',
      );
    });
  });

  test('a thrown request (network failure) reports the generic message', async () => {
    schedulePost.mockRejectedValue(new Error('offline'));
    const { user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'This keyword could not be scheduled. Try again.',
      );
    });
  });

  test('clears a previous error when a retry succeeds', async () => {
    schedulePost.mockResolvedValueOnce(apiResponse(500));
    const { onClose, user } = renderModal();
    await user.click(desktop().getByRole('button', { name: 'Schedule' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    schedulePost.mockResolvedValueOnce(apiResponse(200));
    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('closing', () => {
  test('the header close button calls onClose', async () => {
    const { onClose, user } = renderModal();

    // The backdrop carries the same accessible name but sits outside the dialog.
    await user.click(within(dialog()).getByRole('button', { name: 'Close keyword chooser' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  test('disables the close button while a schedule request is in flight', async () => {
    let settle: (value: unknown) => void = () => {};
    schedulePost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(
        isDisabled(within(dialog()).getByRole('button', { name: 'Close keyword chooser' })),
      ).toBe(true);
    });

    settle(apiResponse(200));
  });

  test('Escape cannot abandon an in-flight schedule request', async () => {
    let settle: (value: unknown) => void = () => {};
    schedulePost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { onClose, user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));
    await waitFor(() => {
      expect(desktop().getByRole('button', { name: 'Scheduling...' })).toBeTruthy();
    });

    // Escape routes through Modal straight into handleClose, bypassing the
    // disabled button — so this exercises the schedulePendingRef guard itself.
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    settle(apiResponse(200));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  test('shows the pending label on the candidate being scheduled', async () => {
    let settle: (value: unknown) => void = () => {};
    schedulePost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { user } = renderModal();

    await user.click(desktop().getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(desktop().getByRole('button', { name: 'Scheduling...' })).toBeTruthy();
    });

    settle(apiResponse(200));
  });
});
