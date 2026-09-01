import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import messages from '../messages/en.json';

/**
 * A `Modal` call site outside the content planner, so #283 has cover here too.
 * Real component, real `en.json`, real QueryClient; only `@/lib/api` is stubbed.
 */

const connectPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: { api: { v0: { dashboard: { integrations: { wordpress: { $post: connectPost } } } } } },
}));

const { WordPressDialog } = await import('../components/integrations/WordPressDialog');

const ORGANIZATION_ID = 'org-1';
const SITE_URL = 'https://example.com';

function apiResponse(status: number, body: unknown = {}) {
  return { ok: status < 400, status, json: async () => body };
}

type Props = Parameters<typeof WordPressDialog>[0];

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    isConnected: false,
    onClose: vi.fn(),
    onConnected: vi.fn(),
    onUnauthorized: vi.fn(),
    open: true,
    organizationId: ORGANIZATION_ID,
    siteUrl: SITE_URL,
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <WordPressDialog {...props} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

  return { ...props, invalidateQueries, user: userEvent.setup() };
}

function dialog() {
  return screen.getByRole('dialog');
}

function tokenInput() {
  return screen.getByLabelText('Integration token');
}

function connectButton() {
  return screen.getByRole('button', { name: 'Connect & test' });
}

function isDisabled(element: HTMLElement) {
  return element.hasAttribute('disabled');
}

beforeEach(() => {
  connectPost.mockReset();
});

describe('setup steps', () => {
  test('focuses the token field, which carries the modal initial-focus marker', async () => {
    renderDialog();

    await waitFor(() => {
      expect(document.activeElement).toBe(tokenInput());
    });
    expect(tokenInput().hasAttribute('data-modal-initial-focus')).toBe(true);
  });

  test('renders the three setup steps', () => {
    renderDialog();

    expect(screen.getByText('Install the SEO Potion plugin')).toBeTruthy();
    expect(screen.getByText('Create your integration token')).toBeTruthy();
    expect(screen.getByText('Connect SEO Potion')).toBeTruthy();
  });

  test('deep-links the step actions into the customer site, without a trailing slash', () => {
    renderDialog({ siteUrl: 'https://example.com///' });

    expect(screen.getByRole('link', { name: /Open Upload Plugin page/ }).getAttribute('href')).toBe(
      'https://example.com/wp-admin/plugin-install.php?tab=upload',
    );
    expect(screen.getByRole('link', { name: /Open plugin settings/ }).getAttribute('href')).toBe(
      'https://example.com/wp-admin/admin.php?page=seo-potion-manage',
    );
  });

  test('offers the plugin zip as a download', () => {
    renderDialog();

    const link = screen.getByRole('link', { name: /Download plugin/ });
    expect(link.getAttribute('href')).toBe('/downloads/seo-potion.zip');
    expect(link.hasAttribute('download')).toBe(true);
  });

  test('keeps the token out of view', () => {
    renderDialog();

    expect(tokenInput().getAttribute('type')).toBe('password');
  });

  test('explains the replacement when a site is already connected', () => {
    renderDialog({ isConnected: true });

    expect(
      screen.getByText(
        'Connecting again tests the new token against your site and replaces the saved one.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText('Install the plugin on your site, then paste the token it gives you.'),
    ).toBeNull();
  });
});

describe('connecting', () => {
  test('cannot connect without a token', () => {
    renderDialog();

    expect(isDisabled(connectButton())).toBe(true);
  });

  test('a whitespace-only token does not enable connecting', async () => {
    const { user } = renderDialog();

    await user.type(tokenInput(), '   ');

    expect(isDisabled(connectButton())).toBe(true);
  });

  test('cannot connect without an organization', async () => {
    const { user } = renderDialog({ organizationId: null });

    await user.type(tokenInput(), 'tok');

    expect(isDisabled(connectButton())).toBe(true);
  });

  test('sends the trimmed token, refreshes integrations, and hands back to the panel', async () => {
    connectPost.mockResolvedValue(apiResponse(200));
    const { onConnected, invalidateQueries, user } = renderDialog();

    await user.type(tokenInput(), '  secret-token  ');
    await user.click(connectButton());

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledOnce();
    });
    expect(connectPost).toHaveBeenCalledWith({
      json: { org_id: ORGANIZATION_ID, token: 'secret-token' },
    });
    expect(
      invalidateQueries.mock.calls.some(
        (call) => (call[0] as { queryKey: readonly string[] }).queryKey.at(-1) === 'connected',
      ),
    ).toBe(true);
  });

  test('Enter in the token field connects', async () => {
    connectPost.mockResolvedValue(apiResponse(200));
    const { onConnected, user } = renderDialog();

    await user.type(tokenInput(), 'secret-token{Enter}');

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledOnce();
    });
  });

  test('shows progress and locks the form while connecting', async () => {
    let settle: (value: unknown) => void = () => {};
    connectPost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { user } = renderDialog();

    await user.type(tokenInput(), 'secret-token');
    await user.click(connectButton());

    await waitFor(() => {
      expect(isDisabled(screen.getByRole('button', { name: 'Connecting...' }))).toBe(true);
    });
    expect(isDisabled(within(dialog()).getByRole('button', { name: 'Close dialog' }))).toBe(true);

    settle(apiResponse(200));
  });

  test('a 401 escalates to onUnauthorized without an error banner', async () => {
    connectPost.mockResolvedValue(apiResponse(401));
    const { onUnauthorized, onConnected, user } = renderDialog();

    await user.type(tokenInput(), 'secret-token');
    await user.click(connectButton());

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
    expect(onConnected).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a thrown request reports that the plugin could not be reached', async () => {
    connectPost.mockRejectedValue(new Error('offline'));
    const { user } = renderDialog();

    await user.type(tokenInput(), 'secret-token');
    await user.click(connectButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain("We couldn't reach the SEO Potion");
    });
  });
});

describe('connection failures point at the step that failed', () => {
  /**
   * The numbered step badge turns red for the step the user has to go back and
   * redo, which is the whole reason `mapErrorCode` carries a step number.
   */
  function stepBadge(index: number) {
    return screen.getByText(String(index));
  }

  test.each([
    [
      'wordpress_request_failed',
      "We couldn't reach the SEO Potion plugin on your site. Make sure the plugin is installed and active (step 1), then try again.",
      1,
    ],
    [
      'integration_not_configured',
      "The plugin doesn't have a saved token yet. Complete step 2 in your WordPress admin, then try again.",
      2,
    ],
    [
      'invalid_integration_key',
      "This token doesn't match the one saved in your WordPress plugin. Re-check step 2 and paste the exact same token.",
      2,
    ],
  ])('%s blames step %s', async (errorCode, message, step) => {
    connectPost.mockResolvedValue(apiResponse(400, { error_code: errorCode }));
    const { onConnected, user } = renderDialog();

    await user.type(tokenInput(), 'secret-token');
    await user.click(connectButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(message);
    });
    expect(onConnected).not.toHaveBeenCalled();
    expect(stepBadge(step).className).toContain('bg-destructive');
  });

  test('an unrecognised error code blames no particular step', async () => {
    connectPost.mockResolvedValue(apiResponse(500, { error_code: 'something_else' }));
    const { user } = renderDialog();

    await user.type(tokenInput(), 'secret-token');
    await user.click(connectButton());

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'WordPress could not be connected. Check the token and try again.',
      );
    });
    expect(screen.getByText('1').className).toContain('bg-foreground');
    expect(screen.getByText('2').className).toContain('bg-foreground');
  });

  test('editing the token clears the previous failure', async () => {
    connectPost.mockResolvedValue(apiResponse(500, {}));
    const { user } = renderDialog();
    await user.type(tokenInput(), 'bad');
    await user.click(connectButton());
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    await user.type(tokenInput(), 'x');

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('closing', () => {
  test('closing clears the token and the error so a reopen starts clean', async () => {
    connectPost.mockResolvedValue(apiResponse(500, {}));
    const { onClose, user } = renderDialog();
    await user.type(tokenInput(), 'bad-token');
    await user.click(connectButton());
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect((tokenInput() as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('Escape cannot abandon an in-flight connection attempt', async () => {
    let settle: (value: unknown) => void = () => {};
    connectPost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const { onClose, user } = renderDialog();
    await user.type(tokenInput(), 'secret-token');
    await user.click(connectButton());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Connecting...' })).toBeTruthy();
    });

    // Escape reaches handleClose directly, past the disabled buttons.
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();

    settle(apiResponse(200));
  });
});
