import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProductOrganization } from '../lib/organizations';
import messages from '../messages/en.json';

const membersGet = vi.hoisted(() => vi.fn());
const membersPost = vi.hoisted(() => vi.fn());
const membersDelete = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: {
    api: {
      v0: {
        core: {
          members: { $get: membersGet, $post: membersPost, $delete: membersDelete },
        },
      },
    },
  },
}));

const { TeamPanel } = await import(
  '../app/[locale]/(authenticated)/(product)/settings/_components/TeamPanel'
);

function apiResponse(status: number, body: unknown = {}) {
  return { ok: status < 400, status, json: async () => body };
}

const roster = {
  members: [
    { email: 'owner@example.com', role: 'owner', created_at: '2026-09-01T00:00:00.000Z' },
    { email: 'mate@example.com', role: 'member', created_at: '2026-09-02T00:00:00.000Z' },
  ],
};

function org(role: ProductOrganization['role']): ProductOrganization {
  return {
    billing_tier: 'free',
    capabilities: { keyword_research: false, keyword_scheduling: false },
    id: 'org-1',
    name: 'Org',
    role,
    setup_status: 'setup_complete',
    website_url: 'https://example.com',
  };
}

function renderPanel(role: ProductOrganization['role']) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <TeamPanel organization={org(role)} onUnauthorized={vi.fn()} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { invalidateQueries, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  membersGet.mockResolvedValue(apiResponse(200, roster));
});

describe('TeamPanel', () => {
  test('owner sees the roster with add and remove controls', async () => {
    const { user, invalidateQueries } = renderPanel('owner');

    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText('mate@example.com')).toBeTruthy();
    // One Remove per member row, none for the owner.
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.queryByText('Only the owner can add or remove teammates.')).toBeNull();

    membersPost.mockResolvedValueOnce(
      apiResponse(201, {
        email: 'new@example.com',
        role: 'member',
        created_at: '2026-09-03T00:00:00.000Z',
      }),
    );
    await user.type(screen.getByLabelText('Teammate email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(membersPost).toHaveBeenCalledWith({
        json: { org_id: 'org-1', email: 'new@example.com' },
      }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'organization', 'org-1', 'members'],
    });
    expect((screen.getByLabelText('Teammate email') as HTMLInputElement).value).toBe('');
  });

  test('owner sees the already-member message on 409', async () => {
    const { user } = renderPanel('owner');
    await screen.findByText('mate@example.com');

    membersPost.mockResolvedValueOnce(apiResponse(409, { error: 'already_member' }));
    await user.type(screen.getByLabelText('Teammate email'), 'mate@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('That email is already on the team.')).toBeTruthy();
  });

  test('owner removes a member', async () => {
    const { user, invalidateQueries } = renderPanel('owner');
    await screen.findByText('mate@example.com');

    membersDelete.mockResolvedValueOnce(apiResponse(200, { ok: true }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(membersDelete).toHaveBeenCalledWith({
        json: { org_id: 'org-1', email: 'mate@example.com' },
      }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'organization', 'org-1', 'members'],
    });
  });

  test('member sees the roster read-only', async () => {
    renderPanel('member');

    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    expect(screen.queryByLabelText('Teammate email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByText('Only the owner can add or remove teammates.')).toBeTruthy();
  });
});
