import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PlannerKeywordResponse } from '../app/[locale]/(authenticated)/(product)/content-planner/types';
import messages from '../messages/en.json';

/**
 * The content planner's own data layer, as opposed to
 * `content-planner-modal-wiring.test.tsx`, which drives the same page but only
 * cares about modal-to-modal handoff.
 *
 * Covered here: what the page derives from its two queries — the strategy-status
 * panels, the status-message ladder, calendar construction, month navigation,
 * candidate-pool paging, fixtures mode, and the 401 escalation.
 *
 * The clock is pinned, because a calendar that renders "today" is otherwise a
 * test that changes meaning every day.
 */

const plannerGet = vi.hoisted(() => vi.fn());
const candidatesGet = vi.hoisted(() => vi.fn());
const organizationState = vi.hoisted(() => ({
  current: {} as { error: string | null; loading: boolean; organization: unknown },
}));
const clearToken = vi.hoisted(() => vi.fn());
const clearWorkspaceStatusCache = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: {
    api: {
      v0: {
        dashboard: { planner: { $get: plannerGet } },
        keywords: {
          candidates: {
            $get: candidatesGet,
            $post: vi.fn(),
            ':candidate_id': { schedule: { $post: vi.fn() } },
          },
          research: { $post: vi.fn() },
        },
      },
    },
  },
}));

vi.mock('@/lib/organizations', () => ({
  useActiveOrganization: () => organizationState.current,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock('@/lib/auth', () => ({ clearToken, getToken: () => 'token' }));
vi.mock('@/lib/session', () => ({ clearWorkspaceStatusCache }));

const { default: ContentPlannerPage } = await import(
  '../app/[locale]/(authenticated)/(product)/content-planner/page'
);

/** A Tuesday, mid-month, so both past and future days exist in the visible month. */
const TODAY = new Date('2026-09-15T12:00:00.000Z');
const ORGANIZATION = {
  id: 'org-1',
  name: 'Test Org',
  capabilities: { keyword_research: true, keyword_scheduling: true },
};

function apiResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function plannerKeyword(overrides: Partial<PlannerKeywordResponse> = {}): PlannerKeywordResponse {
  return {
    article_id: null,
    candidate_id: 'cand-1',
    difficulty: 30,
    generation_error: null,
    generation_status: 'pending',
    id: 'plan-1',
    intent: 'informational',
    keyword: 'content marketing',
    opportunity_score: 70,
    scheduled_date: '2026-09-20',
    search_volume: 1200,
    ...overrides,
  };
}

function plannerBody(
  keywords: PlannerKeywordResponse[] = [],
  strategyStatus: 'none' | 'pending' | 'completed' | 'failed' = 'completed',
) {
  return { keywords, strategy_status: strategyStatus };
}

function candidatePage(total = 0, candidates: unknown[] = [], offset = 0) {
  return { candidates, limit: 100, offset, total };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const clear = vi.spyOn(queryClient, 'clear');

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <ContentPlannerPage />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

  return { clear, user: userEvent.setup() };
}

/** The desktop calendar grid; the mobile agenda renders the same days again. */
function calendar() {
  return within(screen.getByRole('region', { name: 'Content calendar grid' }));
}

async function waitForCalendar() {
  await waitFor(() => {
    expect(screen.getByRole('region', { name: 'Content calendar grid' })).toBeTruthy();
  });
}

function isDisabled(element: HTMLElement) {
  return element.hasAttribute('disabled');
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: TODAY });
  plannerGet.mockReset();
  candidatesGet.mockReset();
  clearToken.mockReset();
  clearWorkspaceStatusCache.mockReset();
  routerReplace.mockReset();
  organizationState.current = { error: null, loading: false, organization: ORGANIZATION };
  plannerGet.mockResolvedValue(apiResponse(200, plannerBody()));
  candidatesGet.mockResolvedValue(apiResponse(200, candidatePage()));
  window.history.replaceState({}, '', '/en/content-planner');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('status messages', () => {
  test('announces loading while the organization is still resolving', () => {
    organizationState.current = { error: null, loading: true, organization: null };
    renderPage();

    expect(screen.getByText('Loading content planner...')).toBeTruthy();
  });

  test('explains a missing organization', async () => {
    organizationState.current = { error: 'no_organization', loading: false, organization: null };
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('No completed organization was found for this workspace.'),
      ).toBeTruthy();
    });
  });

  test('explains an organization that failed to load', async () => {
    organizationState.current = { error: 'unavailable', loading: false, organization: null };
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Could not load your organization. Try again.')).toBeTruthy();
    });
  });

  test('explains a planner request that failed', async () => {
    plannerGet.mockResolvedValue(apiResponse(500, {}));
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(
          'Could not load the content planner. Try again when the API is available.',
        ),
      ).toBeTruthy();
    });
  });
});

describe('strategy status', () => {
  test('shows the pending panel instead of a calendar while the plan is building', async () => {
    plannerGet.mockResolvedValue(apiResponse(200, plannerBody([], 'pending')));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Your 30-day content plan is in progress')).toBeTruthy();
    });
    expect(screen.getByRole('status').textContent).toContain('This might take 6–10 minutes.');
    expect(screen.queryByRole('region', { name: 'Content calendar grid' })).toBeNull();
  });

  test('does not fetch the candidate pool while the plan is still pending', async () => {
    plannerGet.mockResolvedValue(apiResponse(200, plannerBody([], 'pending')));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Your 30-day content plan is in progress')).toBeTruthy();
    });
    expect(candidatesGet).not.toHaveBeenCalled();
  });

  test('shows the failure panel when the plan could not be built', async () => {
    plannerGet.mockResolvedValue(apiResponse(200, plannerBody([], 'failed')));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Your content plan could not be created')).toBeTruthy();
    });
    expect(screen.queryByRole('region', { name: 'Content calendar grid' })).toBeNull();
  });

  test('shows the calendar once the plan is complete', async () => {
    renderPage();

    await waitForCalendar();
  });
});

describe('calendar construction', () => {
  test('places a scheduled article on its date and counts it in the summary', async () => {
    plannerGet.mockResolvedValue(
      apiResponse(200, plannerBody([plannerKeyword({ scheduled_date: '2026-09-20' })])),
    );
    renderPage();
    await waitForCalendar();

    expect(calendar().getByText('content marketing')).toBeTruthy();
    expect(screen.getByText('1 scheduled')).toBeTruthy();
    expect(screen.getByText('1 article per day')).toBeTruthy();
  });

  test('badges a generated article, and a scheduled one as awaiting generation', async () => {
    plannerGet.mockResolvedValue(
      apiResponse(
        200,
        plannerBody([
          plannerKeyword({
            article_id: 'a1',
            id: 'p1',
            keyword: 'done',
            scheduled_date: '2026-09-20',
          }),
          plannerKeyword({
            article_id: null,
            generation_status: 'pending',
            id: 'p2',
            keyword: 'todo',
            scheduled_date: '2026-09-21',
          }),
        ]),
      ),
    );
    renderPage();
    await waitForCalendar();

    expect(calendar().getByText('Generated')).toBeTruthy();
    // Not "Planned" — the calendar badge reuses the target-keyword vocabulary.
    expect(calendar().getByText('Scheduled')).toBeTruthy();
  });

  test('a planned article that is not queued yet gets no badge at all', async () => {
    plannerGet.mockResolvedValue(
      apiResponse(
        200,
        plannerBody([
          plannerKeyword({
            article_id: null,
            generation_status: 'failed',
            scheduled_date: '2026-09-20',
          }),
        ]),
      ),
    );
    renderPage();
    await waitForCalendar();

    expect(calendar().getByText('content marketing')).toBeTruthy();
    expect(calendar().queryByText('Scheduled')).toBeNull();
    expect(calendar().queryByText('Generated')).toBeNull();
  });

  test('renders the seven weekday headings', async () => {
    renderPage();
    await waitForCalendar();

    for (const weekday of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(calendar().getByText(weekday)).toBeTruthy();
    }
  });

  test('offers a chooser on an empty future date but not on a past one', async () => {
    renderPage();
    await waitForCalendar();

    // Today is 15 Sept 2026.
    expect(
      calendar().getByRole('button', { name: /Choose a keyword for .*20, 2026/ }),
    ).toBeTruthy();
    expect(
      calendar().queryByRole('button', { name: /Choose a keyword for .*10, 2026/ }),
    ).toBeNull();
  });

  test('a date that already has an article offers the article, not a chooser', async () => {
    plannerGet.mockResolvedValue(
      apiResponse(200, plannerBody([plannerKeyword({ scheduled_date: '2026-09-20' })])),
    );
    renderPage();
    await waitForCalendar();

    expect(
      calendar().queryByRole('button', { name: /Choose a keyword for .*20, 2026/ }),
    ).toBeNull();
    expect(calendar().getByRole('button', { name: /Open .* details/ })).toBeTruthy();
  });

  test('opening an article shows its details dialog', async () => {
    plannerGet.mockResolvedValue(
      apiResponse(200, plannerBody([plannerKeyword({ scheduled_date: '2026-09-20' })])),
    );
    const { user } = renderPage();
    await waitForCalendar();

    await user.click(calendar().getByRole('button', { name: /Open .* details/ }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('This article has not been generated yet.')).toBeTruthy();
  });
});

describe('returning focus after a dialog closes', () => {
  /**
   * Radix restores focus to whatever was focused when *that* dialog opened,
   * which is wrong for a chain and unobservable under jsdom anyway. The page
   * owns the restore instead, so this is where it has to be proven — for the
   * article editor as well as the keyword chooser.
   */
  test('focus goes back to the calendar entry that opened the article editor', async () => {
    plannerGet.mockResolvedValue(
      apiResponse(200, plannerBody([plannerKeyword({ scheduled_date: '2026-09-20' })])),
    );
    const { user } = renderPage();

    const entries = await screen.findAllByRole('button', { name: /^Open .* details$/ });
    const trigger = entries[0] as HTMLElement;
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});

describe('month navigation', () => {
  test('starts on the current month with Today disabled', async () => {
    renderPage();
    await waitForCalendar();

    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Today' }))).toBe(true);
  });

  test('moves back and forward a month', async () => {
    const { user } = renderPage();
    await waitForCalendar();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('August 2026')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  test('Today returns to the current month and disables itself again', async () => {
    const { user } = renderPage();
    await waitForCalendar();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(isDisabled(screen.getByRole('button', { name: 'Today' }))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Today' }));

    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Today' }))).toBe(true);
  });

  test('the month label is announced politely', async () => {
    renderPage();
    await waitForCalendar();

    expect(screen.getByText('September 2026').getAttribute('aria-live')).toBe('polite');
  });
});

describe('candidate pool paging', () => {
  test('fetches every page, because Target Keywords paginates client-side', async () => {
    candidatesGet
      .mockResolvedValueOnce(apiResponse(200, candidatePage(150, [], 0)))
      .mockResolvedValueOnce(apiResponse(200, candidatePage(150, [], 100)));
    renderPage();

    await waitFor(() => {
      expect(candidatesGet).toHaveBeenCalledTimes(2);
    });
    expect(candidatesGet.mock.calls[0]?.[0]?.query).toMatchObject({ limit: '100', offset: '0' });
    expect(candidatesGet.mock.calls[1]?.[0]?.query).toMatchObject({ limit: '100', offset: '100' });
  });

  test('stops after one page when the pool fits', async () => {
    candidatesGet.mockResolvedValue(apiResponse(200, candidatePage(10, [], 0)));
    renderPage();
    await waitForCalendar();

    await waitFor(() => {
      expect(candidatesGet).toHaveBeenCalledTimes(1);
    });
  });

  test('asks only for candidates that are still available', async () => {
    renderPage();

    await waitFor(() => {
      expect(candidatesGet).toHaveBeenCalledWith({
        query: { limit: '100', offset: '0', org_id: 'org-1', status: 'candidate' },
      });
    });
  });
});

describe('fixtures mode', () => {
  test('?fixtures=1 renders sample articles without calling the API', async () => {
    window.history.replaceState({}, '', '/en/content-planner?fixtures=1');
    renderPage();

    await waitForCalendar();
    expect(plannerGet).not.toHaveBeenCalled();
    expect(candidatesGet).not.toHaveBeenCalled();
    // The fixtures exist precisely so the calendar is populated without a backend.
    expect(screen.queryByText('0 scheduled')).toBeNull();
  });

  test('?pending=1 previews the pending panel without calling the API', async () => {
    window.history.replaceState({}, '', '/en/content-planner?pending=1');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Your 30-day content plan is in progress')).toBeTruthy();
    });
    expect(plannerGet).not.toHaveBeenCalled();
  });
});

describe('session expiry', () => {
  test('a 401 from the planner clears the session and sends the user home', async () => {
    plannerGet.mockResolvedValue(apiResponse(401, {}));
    const { clear } = renderPage();

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith('/');
    });
    expect(clearToken).toHaveBeenCalled();
    expect(clearWorkspaceStatusCache).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });

  test('the load error is suppressed while redirecting away', async () => {
    plannerGet.mockResolvedValue(apiResponse(401, {}));
    renderPage();

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith('/');
    });
    expect(
      screen.queryByText(
        'Could not load the content planner. Try again when the API is available.',
      ),
    ).toBeNull();
    expect(screen.getByText('Loading content planner...')).toBeTruthy();
  });
});
