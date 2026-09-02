import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import messages from '../messages/en.json';

/**
 * The last piece of the chained-dialog story: `page.tsx`'s own wiring.
 *
 * `choose-keyword-modal.test.tsx` and `research-keywords-modal.test.tsx` cover
 * each modal in isolation, and `modal.test.tsx` covers the handoff through a
 * harness. What only the page can show is that `handleOpenResearch` really does
 * close the chooser and open research *in a single state update*, and that the
 * focus handoff survives it end to end.
 *
 * Scope is deliberately narrow: modal-to-modal wiring, not the planner's data
 * layer. The stubs are the app's boundaries (HTTP, org context, router, auth),
 * never the components under test.
 */

const plannerGet = vi.hoisted(() => vi.fn());
const candidatesGet = vi.hoisted(() => vi.fn());

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
  useActiveOrganization: () => ({
    error: null,
    loading: false,
    organization: {
      id: 'org-1',
      name: 'Test Org',
      capabilities: { keyword_research: true, keyword_scheduling: true },
    },
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/auth', () => ({ clearToken: vi.fn(), getToken: () => 'token' }));
vi.mock('@/lib/session', () => ({ clearWorkspaceStatusCache: vi.fn() }));

const { default: ContentPlannerPage } = await import(
  '../app/[locale]/(authenticated)/(product)/content-planner/page'
);

function apiResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <ContentPlannerPage />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

  return { user: userEvent.setup() };
}

/**
 * The calendar grid and the mobile agenda both render a chooser button per day,
 * so every date has two. The first is the desktop grid's.
 */
async function firstChooserButton() {
  const buttons = await screen.findAllByRole('button', { name: /^Choose a keyword for/ });
  const button = buttons[0];

  if (!button) {
    throw new Error('no chooser button rendered');
  }

  return button;
}

function openDialogs() {
  return screen.queryAllByRole('dialog');
}

/**
 * Read the lock through the cascade, not off `body.style`: the hand-rolled Modal
 * set an inline style, Radix injects a stylesheet, and only the computed value
 * answers "is the background actually locked" for both.
 */
function backgroundScrollLocked() {
  return window.getComputedStyle(document.body).overflow === 'hidden';
}

/** The page marks its content inert while any modal is open. */
function pageContent() {
  const content = document.querySelector('[inert]');
  return content instanceof HTMLElement ? content : null;
}

beforeEach(() => {
  document.body.style.overflow = '';
  plannerGet.mockResolvedValue(apiResponse(200, { keywords: [], strategy_status: 'completed' }));
  // An empty candidate pool is what puts the chooser into the empty state that
  // offers "Research Keywords" — the entry point to the handoff.
  candidatesGet.mockResolvedValue(
    apiResponse(200, { candidates: [], limit: 100, offset: 0, total: 0 }),
  );
});

describe('opening the chooser from the calendar', () => {
  test('a calendar date opens the chooser for that date', async () => {
    const { user } = renderPage();

    const trigger = await firstChooserButton();
    await user.click(trigger);

    // The chooser is labelled with the same date the trigger names, so the
    // dateKey really did travel from the calendar cell into the modal.
    const label = trigger.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/^Choose a keyword for /);
    expect(await screen.findByRole('dialog', { name: label })).toBeTruthy();
  });

  test('only one dialog is ever open at a time', async () => {
    const { user } = renderPage();

    await user.click(await firstChooserButton());

    await waitFor(() => {
      expect(openDialogs()).toHaveLength(1);
    });
  });
});

describe('handleOpenResearch', () => {
  test('swaps the chooser for research in one update, never showing both or neither', async () => {
    const { user } = renderPage();
    await user.click(await firstChooserButton());
    await screen.findByRole('dialog', { name: /^Choose a keyword for/ });

    await user.click(screen.getByRole('button', { name: 'Research Keywords' }));

    // The swap is a single state update, so at no point are there two dialogs.
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Research Keywords' })).toBeTruthy();
    });
    expect(openDialogs()).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: /^Choose a keyword for/ })).toBeNull();
  });

  test('returns focus to the calendar date that started the chain', async () => {
    const { user } = renderPage();
    const trigger = await firstChooserButton();
    await user.click(trigger);
    await screen.findByRole('dialog', { name: /^Choose a keyword for/ });

    await user.click(screen.getByRole('button', { name: 'Research Keywords' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Research Keywords' })).toBeTruthy();
    });

    await user.keyboard('{Escape}');

    // The page owns the chain's return focus (`modalReturnFocusRef` in page.tsx):
    // Radix would restore to a control inside the torn-down chooser, so the page
    // remembers the calendar button that started the chain and restores to it.
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  test('keeps background scroll locked continuously across the swap', async () => {
    const { user } = renderPage();
    await user.click(await firstChooserButton());
    await screen.findByRole('dialog', { name: /^Choose a keyword for/ });
    expect(backgroundScrollLocked()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Research Keywords' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Research Keywords' })).toBeTruthy();
    });
    expect(backgroundScrollLocked()).toBe(true);

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(backgroundScrollLocked()).toBe(false);
    });
  });
});

describe('handleChooseDate', () => {
  test('the calendar is unreachable while a modal is open', async () => {
    const { user } = renderPage();
    await user.click(await firstChooserButton());
    await screen.findByRole('dialog', { name: /^Choose a keyword for/ });

    // The page content is inert and aria-hidden, so no calendar date is
    // reachable. This is why handleChooseDate's own `setResearchModalOpen(false)`
    // can never fire from the UI — see the note in the PR description.
    expect(screen.queryAllByRole('button', { name: /^Choose a keyword for/ })).toHaveLength(0);
  });

  test('picking a date after research closes opens the chooser, not research', async () => {
    const { user } = renderPage();
    await user.click(await firstChooserButton());
    await user.click(await screen.findByRole('button', { name: 'Research Keywords' }));
    await screen.findByRole('dialog', { name: 'Research Keywords' });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(openDialogs()).toHaveLength(0);
    });
    await user.click(await firstChooserButton());

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /^Choose a keyword for/ })).toBeTruthy();
    });
    expect(screen.queryByRole('dialog', { name: 'Research Keywords' })).toBeNull();
  });
});

describe('background inertness', () => {
  test('marks the page content inert and aria-hidden while a modal is open', async () => {
    const { user } = renderPage();
    expect(pageContent()).toBeNull();

    await user.click(await firstChooserButton());
    await screen.findByRole('dialog', { name: /^Choose a keyword for/ });

    const content = pageContent();
    expect(content).not.toBeNull();
    expect(content?.getAttribute('aria-hidden')).toBe('true');
    // The dialog must not be inside the inert subtree, or it would be unusable.
    expect(content?.contains(screen.getByRole('dialog'))).toBe(false);
  });

  test('stays inert across the chooser to research swap, and is restored after', async () => {
    const { user } = renderPage();
    await user.click(await firstChooserButton());
    await screen.findByRole('dialog', { name: /^Choose a keyword for/ });

    await user.click(screen.getByRole('button', { name: 'Research Keywords' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Research Keywords' })).toBeTruthy();
    });
    expect(pageContent()).not.toBeNull();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(pageContent()).toBeNull();
    });
    expect(document.querySelector('[aria-hidden="true"][class*="grid"]')).toBeNull();
  });
});
