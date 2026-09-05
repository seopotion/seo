import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActiveOrganizationState, ProductOrganization } from '../lib/organizations';
import messages from '../messages/en.json';

/**
 * The switch itself: it writes the store and navigates, and neither half is
 * observable from a type check. Radix Select is driven for real, so the mocked
 * surface stays at the edges — the router and the two org hooks.
 */

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const useActiveOrganization = vi.hoisted(() => vi.fn());
const useOrganizations = vi.hoisted(() => vi.fn());

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, replace }),
  usePathname: () => '/home',
}));

vi.mock('@/lib/organizations', () => ({ useActiveOrganization, useOrganizations }));

const { clearActiveOrganizationId, getActiveOrganizationId } = await import(
  '../lib/active-organization'
);
const { OrganizationSwitcher } = await import(
  '../app/[locale]/(authenticated)/(product)/OrganizationSwitcher'
);

function org(overrides: Partial<ProductOrganization> = {}): ProductOrganization {
  return {
    billing_tier: 'free',
    capabilities: { keyword_research: false, keyword_scheduling: false },
    id: 'c1',
    name: 'Org One',
    setup_status: 'setup_complete',
    website_url: 'https://one.example',
    ...overrides,
  };
}

const first = org();
const second = org({ id: 'c2', name: 'Org Two', website_url: 'https://two.example' });
const scanning = org({
  id: 's1',
  name: 'Org Scanning',
  setup_status: 'setup_scan_in_progress',
  website_url: 'https://scanning.example',
});

function renderSwitcher(active: ProductOrganization | null, organizations: ProductOrganization[]) {
  useActiveOrganization.mockReturnValue({
    error: null,
    loading: false,
    organization: active,
  } satisfies ActiveOrganizationState);
  useOrganizations.mockReturnValue(organizations);

  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <OrganizationSwitcher />
    </NextIntlClientProvider>,
  );

  // Radix checks pointer capture and scrolls the active item into view; jsdom
  // implements neither, and its own pointer-events answer makes user-event
  // refuse the click on the portalled listbox.
  return { ...view, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Switch organization' }));
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  clearActiveOrganizationId();
});

describe('rendering', () => {
  test('renders nothing without an active org', () => {
    const { container } = renderSwitcher(null, [first, second]);

    expect(container.innerHTML).toBe('');
  });

  test('shows the active org name and host on the settings half of the control', () => {
    renderSwitcher(first, [first, second]);

    const link = screen.getByRole('link', { name: 'Open workspace settings' });
    expect(link.getAttribute('href')).toBe('/settings');
    expect(link.textContent).toContain('Org One');
    expect(link.textContent).toContain('one.example');
  });

  test('only the chevron button opens the menu', async () => {
    const { user } = renderSwitcher(first, [first, second]);
    await user.click(screen.getByRole('link', { name: 'Open workspace settings' }));

    expect(screen.queryByRole('listbox')).toBeNull();

    await openMenu(user);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  test('lists only completed orgs', async () => {
    const { user } = renderSwitcher(first, [first, scanning, second]);
    await openMenu(user);

    expect(screen.getByRole('option', { name: /Org One/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Org Two/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Org Scanning/ })).toBeNull();
  });
});

describe('choosing an item', () => {
  test('another org becomes active and the shell goes back to /home', async () => {
    const { user } = renderSwitcher(first, [first, second]);
    await openMenu(user);
    await user.click(screen.getByRole('option', { name: /Org Two/ }));

    expect(getActiveOrganizationId()).toBe('c2');
    expect(replace).toHaveBeenCalledWith('/home');
    expect(push).not.toHaveBeenCalled();
  });

  test('re-picking the active org changes nothing', async () => {
    const { user } = renderSwitcher(first, [first, second]);
    await openMenu(user);
    await user.click(screen.getByRole('option', { name: /Org One/ }));

    expect(getActiveOrganizationId()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  test('"Add website" navigates to onboarding without touching the store', async () => {
    const { user } = renderSwitcher(first, [first, second]);
    await openMenu(user);
    await user.click(screen.getByRole('option', { name: 'Add website' }));

    expect(push).toHaveBeenCalledWith('/onboarding?new=1');
    expect(getActiveOrganizationId()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
