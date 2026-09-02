import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PlannerArticle } from '../app/[locale]/(authenticated)/(product)/content-planner/types';
import messages from '../messages/en.json';

/**
 * This dialog used to carry its own copy of the focus trap — a second
 * `FOCUSABLE_SELECTOR`, its own Escape handler and its own `body.style.overflow`
 * lock, in `useDialogFocusManagement`. #283 folded it onto the shared
 * `components/ui/dialog`, so all five dialogs now share one implementation.
 *
 * It is still the odd one out in one respect: its preferred focus target lives
 * inside `ArticleEditorPanel`, several layers down, so it is found by the
 * `data-dialog-initial-focus` attribute rather than threaded through as a ref.
 *
 * The editing engine (`useArticleEditor`) is stubbed — it is a data layer with
 * its own concerns. What is under test here is the dialog shell around it.
 */

const editorState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const requestClose = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/article-editor', () => ({
  useArticleEditor: () => editorState.current,
}));

const { ArticleEditorModal } = await import(
  '../app/[locale]/(authenticated)/(product)/content-planner/_components/ArticleEditorModal'
);

function plannerArticle(overrides: Partial<PlannerArticle> = {}): PlannerArticle {
  return {
    articleId: null,
    candidateId: 'cand-1',
    difficulty: 30,
    generationError: null,
    generationStatus: 'pending',
    id: 'plan-1',
    intent: 'informational',
    keyword: 'content marketing',
    opportunityScore: 70,
    scheduledDate: '2026-09-10',
    status: 'planned',
    title: 'Content marketing',
    volume: 1200,
    ...overrides,
  };
}

type Props = Parameters<typeof ArticleEditorModal>[0];

function renderModal(overrides: Partial<Props> = {}) {
  const props: Props = {
    article: plannerArticle(),
    fixturesEnabled: false,
    onClose: vi.fn(),
    onUnauthorized: vi.fn(),
    organizationId: 'org-1',
    ...overrides,
  };

  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ArticleEditorModal {...props} />
    </NextIntlClientProvider>,
  );

  return { ...props, ...result, user: userEvent.setup() };
}

/** The load-error panel is the branch with two focusable controls to trap between. */
function renderLoadErrorPanel() {
  editorState.current = { ...editorState.current, isError: true, isPending: false };
  return renderModal({ article: plannerArticle({ articleId: 'article-1', status: 'generated' }) });
}

function dialog() {
  return screen.getByRole('dialog');
}

/**
 * Read the lock through the cascade, not off `body.style`: Radix injects a
 * stylesheet with `!important` rather than setting an inline style, so only the
 * computed value answers "is the background actually locked".
 */
function bodyOverflow() {
  return window.getComputedStyle(document.body).overflow;
}

beforeEach(() => {
  document.body.style.overflow = '';
  requestClose.mockReset();
  refetch.mockReset();
  editorState.current = {
    article: null,
    canSave: false,
    continueEditing: vi.fn(),
    dirty: false,
    discardAndClose: vi.fn(),
    draftArticle: null,
    isError: false,
    isPending: false,
    refetch,
    requestClose,
    saveArticle: vi.fn(),
    saveError: null,
    saveState: 'idle',
    serverInvalidFields: [],
    showCloseConfirmation: false,
    updateDraftField: vi.fn(),
    validation: {},
  };
});

describe('planned (not yet generated) article', () => {
  test('renders nothing when no article is selected', () => {
    renderModal({ article: null });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  test('shows the keyword, the not-generated note and the metrics', () => {
    renderModal();

    const panel = dialog();
    expect(within(panel).getByRole('heading', { name: 'content marketing' })).toBeTruthy();
    expect(within(panel).getByText('This article has not been generated yet.')).toBeTruthy();
    expect(within(panel).getByText('1,200')).toBeTruthy();
    expect(within(panel).getByText('30')).toBeTruthy();
    expect(within(panel).getByText('Planned')).toBeTruthy();
  });

  test('is a dialog that hides the rest of the page, labelled by its heading', () => {
    const { container } = renderModal();

    expect(screen.getByRole('dialog', { name: 'content marketing' })).toBe(dialog());
    // Radix hides the rest of the tree rather than setting `aria-modal`. That is
    // the same guarantee reached a different way, so assert the guarantee.
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(dialog().closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('focus and scroll behaviour', () => {
  test('initial focus goes to the control marked data-dialog-initial-focus', async () => {
    renderModal();

    const close = within(dialog()).getByRole('button', { name: 'Close details' });
    await waitFor(() => {
      expect(document.activeElement).toBe(close);
    });
    expect(close.hasAttribute('data-dialog-initial-focus')).toBe(true);
  });

  test('prefers the marked control over the first one in the DOM', async () => {
    renderLoadErrorPanel();

    // The load-error panel marks "Try again", while the close button comes
    // first in DOM order — so this is the case that actually distinguishes the
    // marker from the "first focusable" fallback.
    const retry = within(dialog()).getByRole('button', { name: 'Try again' });
    const buttons = within(dialog()).getAllByRole('button');
    expect(buttons[0]).not.toBe(retry);

    await waitFor(() => {
      expect(document.activeElement).toBe(retry);
    });
  });

  test('Tab from the last control wraps to the first', async () => {
    const { user } = renderLoadErrorPanel();
    const buttons = within(dialog()).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(1);
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    await waitFor(() => {
      expect(dialog().contains(document.activeElement)).toBe(true);
    });

    last.focus();
    await user.tab();

    expect(document.activeElement).toBe(first);
  });

  test('Shift+Tab from the first control wraps to the last', async () => {
    const { user } = renderLoadErrorPanel();
    const buttons = within(dialog()).getAllByRole('button');
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    await waitFor(() => {
      expect(dialog().contains(document.activeElement)).toBe(true);
    });

    first.focus();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(last);
  });

  test('Tab pulls focus back in when it has escaped', async () => {
    const { user } = renderLoadErrorPanel();
    const outside = document.createElement('button');
    document.body.append(outside);
    await waitFor(() => {
      expect(dialog().contains(document.activeElement)).toBe(true);
    });

    outside.focus();
    await user.tab();

    expect(dialog().contains(document.activeElement)).toBe(true);
    outside.remove();
  });

  test('Escape asks the editor to close', async () => {
    const { user } = renderModal();

    await user.keyboard('{Escape}');

    expect(requestClose).toHaveBeenCalledOnce();
  });

  test('the backdrop asks the editor to close', async () => {
    const { user } = renderModal();

    await user.click(screen.getAllByRole('button', { name: 'Close details' })[0] as HTMLElement);

    expect(requestClose).toHaveBeenCalled();
  });

  test('locks background scroll while open and restores it on unmount', () => {
    const { unmount } = renderModal();
    expect(bodyOverflow()).toBe('hidden');

    unmount();

    expect(bodyOverflow()).not.toBe('hidden');
  });

  test('restores a pre-existing overflow value rather than clearing it', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = renderModal();
    expect(bodyOverflow()).toBe('hidden');

    unmount();

    expect(bodyOverflow()).toBe('scroll');
  });

  test('re-runs initial focus when the selected article changes', async () => {
    const { rerender } = renderModal();
    await waitFor(() => {
      expect(
        document.activeElement === within(dialog()).getByRole('button', { name: 'Close details' }),
      ).toBe(true);
    });
    // Move focus away, then swap the article — focusKey changes, so the effect
    // re-runs and focus is placed again.
    (document.activeElement as HTMLElement).blur();

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ArticleEditorModal
          article={plannerArticle({ id: 'plan-2', keyword: 'seo audit' })}
          fixturesEnabled={false}
          onClose={vi.fn()}
          onUnauthorized={vi.fn()}
          organizationId="org-1"
        />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(dialog()).getByRole('button', { name: 'Close details' }),
      );
    });
  });
});

describe('generated article, editor not loaded', () => {
  test('shows the loading panel while the article is being fetched', () => {
    editorState.current = { ...editorState.current, isPending: true };
    renderModal({ article: plannerArticle({ articleId: 'article-1', status: 'generated' }) });

    expect(within(dialog()).getByText('Loading article…')).toBeTruthy();
  });

  test('shows the load error with a retry that reaches the editor', async () => {
    const { user } = renderLoadErrorPanel();

    expect(
      within(dialog()).getByText(
        "We couldn't load this article. Check your connection and try again.",
      ),
    ).toBeTruthy();
    await user.click(within(dialog()).getByRole('button', { name: 'Try again' }));

    expect(refetch).toHaveBeenCalledOnce();
  });

  test('shows the not-found panel when the article is gone', () => {
    editorState.current = { ...editorState.current, isError: false, isPending: false };
    renderModal({ article: plannerArticle({ articleId: 'article-1', status: 'generated' }) });

    expect(
      within(dialog()).getByText('This article no longer exists. It may have been deleted.'),
    ).toBeTruthy();
  });
});
