import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { AuthedLayout } from '../src/components/AuthedLayout';

const mocks = vi.hoisted(() => ({
  local: true,
  getToken: vi.fn(),
  openLocalAdminSession: vi.fn(),
}));
vi.mock('../src/lib/env', () => ({
  get LOCAL_ADMIN_SESSION() {
    return mocks.local;
  },
}));
vi.mock('../src/lib/auth', () => ({
  getToken: mocks.getToken,
  getOperatorEmail: () => 'operator@example.com',
  clearToken: vi.fn(),
}));
vi.mock('../src/lib/local-session', () => ({ openLocalAdminSession: mocks.openLocalAdminSession }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.local = true;
  mocks.getToken.mockReturnValue(null);
  mocks.openLocalAdminSession.mockImplementation(async () => {
    mocks.getToken.mockReturnValue('token');
  });
});

function setup() {
  const router = createMemoryRouter([
    { element: <AuthedLayout />, children: [{ path: '/', element: <p>Organization search</p> }] },
    { path: '/login', element: <p>Google sign-in</p> },
  ]);
  render(<RouterProvider router={router} />);
}

test('opens the local admin automatically without login or sign-out controls', async () => {
  setup();
  expect(await screen.findByText('Organization search')).toBeTruthy();
  expect(mocks.openLocalAdminSession).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Google sign-in')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});

test('reuses an existing session without asking AWS for another', async () => {
  mocks.getToken.mockReturnValue('existing-token');
  setup();
  expect(await screen.findByText('Organization search')).toBeTruthy();
  expect(mocks.openLocalAdminSession).not.toHaveBeenCalled();
});

test('reports expired AWS credentials and retries without showing a login page', async () => {
  mocks.openLocalAdminSession.mockRejectedValueOnce(new Error('AWS session expired'));
  setup();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'AWS session expired');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry connection' }));
  await waitFor(() => expect(screen.getByText('Organization search')).toBeTruthy());
  expect(mocks.openLocalAdminSession).toHaveBeenCalledTimes(2);
});

test('preserves normal login when the local development option is disabled', async () => {
  mocks.local = false;
  setup();
  expect(await screen.findByText('Google sign-in')).toBeTruthy();
  expect(mocks.openLocalAdminSession).not.toHaveBeenCalled();
});
