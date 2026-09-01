import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { StatusPanel } from '../components/ui/status-panel';

/**
 * A second suite, mostly to prove the jsdom setup generalises past `Modal`. The
 * behaviour worth pinning is the announcement role: an error panel is an
 * assertive `alert`, every other tone is a polite `status`.
 */

describe('announcement role', () => {
  test('the error tone renders as an alert', () => {
    render(<StatusPanel tone="error">Scan failed</StatusPanel>);

    expect(screen.getByRole('alert').textContent).toBe('Scan failed');
  });

  test.each([
    'info',
    'neutral',
    'success',
    'warning',
  ] as const)('the %s tone renders as a status, not an alert', (tone) => {
    render(<StatusPanel tone={tone}>Working on it</StatusPanel>);

    expect(screen.getByRole('status').textContent).toBe('Working on it');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('defaults to a status when no tone is given', () => {
    render(<StatusPanel>Nothing to report</StatusPanel>);

    expect(screen.getByRole('status')).toBeTruthy();
  });

  test('is announced politely', () => {
    render(<StatusPanel tone="success">Done</StatusPanel>);

    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  test('a call site can override the role', () => {
    render(
      <StatusPanel tone="error" role="status">
        Recoverable
      </StatusPanel>,
    );

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('tone classes', () => {
  test('each tone picks its own token set', () => {
    const tones = ['error', 'info', 'neutral', 'success', 'warning'] as const;
    const classNames = tones.map((tone) => {
      const { unmount } = render(<StatusPanel tone={tone}>Message</StatusPanel>);
      const className = screen.getByText('Message').className;
      unmount();
      return className;
    });

    expect(classNames).toEqual([
      expect.stringContaining('border-error-border bg-error-subtle text-error'),
      expect.stringContaining('border-info-border bg-info-subtle text-info'),
      expect.stringContaining('border-border bg-card text-muted-foreground'),
      expect.stringContaining('border-success-border bg-success-subtle text-success'),
      expect.stringContaining('border-warning-border bg-warning-subtle text-warning'),
    ]);
    expect(new Set(classNames).size).toBe(tones.length);
  });

  test('defaults to the neutral tone', () => {
    render(<StatusPanel>Message</StatusPanel>);

    expect(screen.getByText('Message').className).toContain('bg-card');
  });

  test('keeps the shared shape classes and merges a caller className', () => {
    render(<StatusPanel className="mt-4">Message</StatusPanel>);

    const panel = screen.getByText('Message');
    expect(panel.className).toContain('rounded-md');
    expect(panel.className).toContain('mt-4');
  });

  test('exposes the data-slot hook', () => {
    render(<StatusPanel>Message</StatusPanel>);

    expect(screen.getByText('Message').getAttribute('data-slot')).toBe('status-panel');
  });
});
