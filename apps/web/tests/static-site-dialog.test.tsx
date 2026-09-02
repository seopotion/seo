import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ConnectedIntegration } from '../lib/integrations';
import messages from '../messages/en.json';

/**
 * The second dialog outside the content planner. This one hands off
 * to github.com with a full-page navigation, which jsdom cannot perform — so
 * `window.location` is replaced with a plain object for the duration.
 */

const installUrlGet = vi.hoisted(() => vi.fn());
const disconnectDelete = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: {
    api: {
      v0: {
        dashboard: {
          integrations: {
            github: { 'install-url': { $get: installUrlGet } },
            ':provider': { $delete: disconnectDelete },
          },
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

const { StaticSiteDialog } = await import(
  '../app/[locale]/(authenticated)/(product)/settings/_components/StaticSiteDialog'
);

const ORGANIZATION = { id: 'org-1', name: 'Test Org' };
const DATE_FORMATTER = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

function apiResponse(status: number, body: unknown = {}) {
  return { ok: status < 400, status, json: async () => body };
}

function integration(overrides: Partial<ConnectedIntegration> = {}): ConnectedIntegration {
  return {
    connected_at: '2026-08-01T10:00:00.000Z',
    last_error: null,
    provider: 'static-site',
    target: 'acme/site@main',
    ...overrides,
  } as ConnectedIntegration;
}

type Props = Parameters<typeof StaticSiteDialog>[0];

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    dateFormatter: DATE_FORMATTER,
    integration: null,
    needsReconnect: false,
    onClose: vi.fn(),
    onDisconnected: vi.fn(),
    onUnauthorized: vi.fn(),
    open: true,
    organization: ORGANIZATION as Props['organization'],
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <StaticSiteDialog {...props} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

  return { ...props, invalidateQueries, user: userEvent.setup() };
}

function dialog() {
  return screen.getByRole('dialog');
}

function isDisabled(element: HTMLElement) {
  return element.hasAttribute('disabled');
}

/** Stands in for the real Location, which jsdom refuses to navigate. */
let location: { href: string };
const realLocation = window.location;

beforeEach(() => {
  installUrlGet.mockReset();
  disconnectDelete.mockReset();
  window.sessionStorage.clear();
  location = { href: 'http://localhost/settings' };
  Object.defineProperty(window, 'location', { configurable: true, value: location });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('disconnected state', () => {
  test('opens with the connect button focused, not the first control', async () => {
    renderDialog();

    const connect = screen.getByRole('button', { name: 'Connect repository' });
    await waitFor(() => {
      expect(document.activeElement).toBe(connect);
    });
    // The header close button comes first, so Radix's default "focus the first
    // tabbable" would land there instead. Focus on connect is deliberate aim.
    const close = within(dialog()).getByRole('button', { name: 'Close dialog' });
    expect(close.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('falls back to the first control when the connect button is disabled', async () => {
    // Without an organization the preferred target cannot take focus. The old
    // hand-rolled Modal checked this before aiming; the replacement has to too,
    // or focus lands nowhere and the trap has nothing to trap.
    renderDialog({ organization: null });

    const connect = screen.getByRole('button', { name: 'Connect repository' });
    expect(isDisabled(connect)).toBe(true);
    await waitFor(() => {
      expect(dialog().contains(document.activeElement)).toBe(true);
    });
    expect(document.activeElement).not.toBe(connect);
  });

  test('explains the GitHub hand-off before it happens', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Custom site (GitHub)' })).toBe(dialog());
    expect(
      screen.getByText(/You'll continue on github.com to choose which repositories/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  test('links the rendering guide, which applies in both states', () => {
    renderDialog();

    expect(
      screen.getByRole('link', { name: /How to render published articles/ }).getAttribute('href'),
    ).toBe('/docs/custom-site');
  });
});

describe('connected state', () => {
  test('shows the target and the connection date', () => {
    renderDialog({ integration: integration() });

    expect(screen.getByText('acme/site@main')).toBeTruthy();
    expect(
      screen.getByText(
        `Connected on ${DATE_FORMATTER.format(new Date('2026-08-01T10:00:00.000Z'))}`,
      ),
    ).toBeTruthy();
  });

  test('offers changing the repository rather than connecting', () => {
    renderDialog({ integration: integration() });

    expect(screen.getByRole('button', { name: 'Change repository' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect repository' })).toBeNull();
  });

  test('offers a reconnect when the installation needs attention', () => {
    renderDialog({ integration: integration(), needsReconnect: true });

    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });

  test('surfaces the last publish error as a readable message', () => {
    renderDialog({
      integration: integration({
        last_error: { code: 'installation_not_found' },
      } as Partial<ConnectedIntegration>),
    });

    expect(screen.getByRole('alert').textContent).toBe(
      "SeoPotion was removed from GitHub, so we can't publish. Reconnect to restore it.",
    );
  });

  test('a publish error code we do not know falls back instead of leaking a raw key', () => {
    renderDialog({
      integration: integration({
        last_error: { code: 'some_new_server_side_code' },
      } as Partial<ConnectedIntegration>),
    });

    expect(screen.getByRole('alert').textContent).toBe(
      'The last publish failed. Try publishing again, or reconnect the repository.',
    );
  });

  test('no banner when the last publish succeeded', () => {
    renderDialog({ integration: integration({ last_error: null }) });

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('starting the GitHub install', () => {
  test('navigates to the returned install URL and remembers the locale to come back to', async () => {
    installUrlGet.mockResolvedValue(apiResponse(200, { url: 'https://github.com/apps/x/install' }));
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Connect repository' }));

    await waitFor(() => {
      expect(location.href).toBe('https://github.com/apps/x/install');
    });
    expect(window.sessionStorage.getItem('seo_github_return_locale')).toBe('en');
    expect(installUrlGet).toHaveBeenCalledWith({ query: { org_id: 'org-1' } });
  });

  test('stays in the leaving state, since the page is on its way out', async () => {
    installUrlGet.mockResolvedValue(apiResponse(200, { url: 'https://github.com/apps/x/install' }));
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Connect repository' }));

    await waitFor(() => {
      expect(isDisabled(screen.getByRole('button', { name: 'Opening GitHub...' }))).toBe(true);
    });
  });

  test('a 401 escalates without showing an install error', async () => {
    installUrlGet.mockResolvedValue(apiResponse(401));
    const { onUnauthorized, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Connect repository' }));

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(location.href).toBe('http://localhost/settings');
  });

  test('a 503 says the feature is not available yet, not that the user should retry now', async () => {
    installUrlGet.mockResolvedValue(apiResponse(503));
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Connect repository' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Publishing to a repository is not available yet. Please try again later.',
      );
    });
    // The button is usable again — unlike the success path, nothing is leaving.
    expect(isDisabled(screen.getByRole('button', { name: 'Connect repository' }))).toBe(false);
  });

  test('any other failure offers a retry', async () => {
    installUrlGet.mockResolvedValue(apiResponse(500));
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Connect repository' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        "We couldn't start the GitHub installation. Please try again.",
      );
    });
  });

  test('a thrown request is reported as an install failure', async () => {
    installUrlGet.mockRejectedValue(new Error('offline'));
    const { user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Connect repository' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        "We couldn't start the GitHub installation. Please try again.",
      );
    });
  });

  test('cannot start without an organization', () => {
    renderDialog({ organization: null });

    expect(isDisabled(screen.getByRole('button', { name: 'Connect repository' }))).toBe(true);
  });
});

describe('disconnecting', () => {
  test('asks for confirmation before disconnecting', async () => {
    const { user } = renderDialog({ integration: integration() });

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(screen.getByRole('button', { name: 'Yes, disconnect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The plain close is withheld while confirming, so the choice is explicit.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(disconnectDelete).not.toHaveBeenCalled();
  });

  test('cancelling returns to the connected state without calling the API', async () => {
    const { user } = renderDialog({ integration: integration() });
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(disconnectDelete).not.toHaveBeenCalled();
  });

  test('confirming disconnects, refreshes integrations, and closes the dialog', async () => {
    disconnectDelete.mockResolvedValue(apiResponse(200));
    const { onDisconnected, invalidateQueries, user } = renderDialog({
      integration: integration(),
    });
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }));

    await waitFor(() => {
      expect(onDisconnected).toHaveBeenCalledOnce();
    });
    expect(disconnectDelete).toHaveBeenCalledWith({
      param: { provider: 'static-site' },
      query: { org_id: 'org-1' },
    });
    expect(
      invalidateQueries.mock.calls.some(
        (call) => (call[0] as { queryKey: readonly string[] }).queryKey.at(-1) === 'connected',
      ),
    ).toBe(true);
  });

  test('a failed disconnect explains itself and keeps the dialog open', async () => {
    disconnectDelete.mockResolvedValue(apiResponse(500));
    const { onDisconnected, user } = renderDialog({ integration: integration() });
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }));

    await waitFor(() => {
      expect(screen.getByText('Could not disconnect. Please try again.')).toBeTruthy();
    });
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  test('a 401 on disconnect escalates without an error banner', async () => {
    disconnectDelete.mockResolvedValue(apiResponse(401));
    const { onUnauthorized, onDisconnected, user } = renderDialog({ integration: integration() });
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }));

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(screen.queryByText('Could not disconnect. Please try again.')).toBeNull();
  });
});

describe('closing', () => {
  test('the footer close button closes', async () => {
    const { onClose, user } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  test('closing abandons a pending disconnect confirmation', async () => {
    const { onClose, user } = renderDialog({ integration: integration() });
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    // The footer close is hidden while confirming, so use the header control.
    await user.click(within(dialog()).getByRole('button', { name: 'Close dialog' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Yes, disconnect' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  test('closing clears a previous install error', async () => {
    installUrlGet.mockResolvedValue(apiResponse(500));
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Connect repository' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
