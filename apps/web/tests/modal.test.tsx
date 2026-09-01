import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Modal } from '../components/ui/modal';

/**
 * Characterization tests for the hand-rolled `Modal`. They describe what it does
 * *today*, so the Radix Dialog swap in #283 has something to answer to. Nothing
 * here is a statement about what the behaviour ought to be.
 */

const MODAL_PROPS = { closeLabel: 'Close', labelledBy: 'dialog-title' };

function DialogBody({ initialFocus }: { initialFocus?: 'second' }) {
  return (
    <>
      <h2 id="dialog-title">Title</h2>
      <button type="button">first</button>
      <button
        type="button"
        {...(initialFocus === 'second' ? { 'data-modal-initial-focus': '' } : {})}
      >
        second
      </button>
      <button type="button">third</button>
    </>
  );
}

/** A trigger plus a modal it opens — the shape a focus-return test needs. */
function ToggleHarness({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Modal {...MODAL_PROPS} open={open} onClose={() => setOpen(false)}>
        {children}
      </Modal>
    </>
  );
}

function dialog() {
  return screen.getByRole('dialog');
}

/**
 * Modal moves focus into itself inside a requestAnimationFrame. Any test that
 * drives focus itself has to wait for that to land first — otherwise the rAF can
 * fire *after* the test's own `.focus()` and silently reset it. That race was
 * green locally and red in CI.
 */
async function waitForInitialFocus() {
  await waitFor(() => {
    expect(dialog().contains(document.activeElement)).toBe(true);
  });
}

beforeEach(() => {
  document.body.style.overflow = '';
});

describe('initial focus', () => {
  test('lands on the element marked data-modal-initial-focus', async () => {
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody initialFocus="second" />
      </Modal>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'second' }));
    });
  });

  test('falls back to the first focusable element when the marker is absent', async () => {
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
    });
  });

  test('falls back to the dialog itself when nothing inside is focusable', async () => {
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <h2 id="dialog-title">Title</h2>
        <p>no focusable children</p>
      </Modal>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(dialog());
    });
  });

  test('skips a disabled marked element and uses the first focusable one instead', async () => {
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <h2 id="dialog-title">Title</h2>
        <button type="button">first</button>
        <button type="button" disabled data-modal-initial-focus>
          disabled
        </button>
      </Modal>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
    });
  });
});

describe('focus trap', () => {
  test('Tab from the last element wraps to the first', async () => {
    const user = userEvent.setup();
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    await waitForInitialFocus();
    screen.getByRole('button', { name: 'third' }).focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  test('Shift+Tab from the first element wraps to the last', async () => {
    const user = userEvent.setup();
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    await waitForInitialFocus();
    screen.getByRole('button', { name: 'first' }).focus();

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'third' }));
  });

  test('Tab in the middle of the dialog moves on normally', async () => {
    const user = userEvent.setup();
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    await waitForInitialFocus();
    screen.getByRole('button', { name: 'first' }).focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'second' }));
  });

  test('Tab pulls focus back in when it has escaped the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
          <DialogBody />
        </Modal>
      </>,
    );
    await waitForInitialFocus();
    screen.getByRole('button', { name: 'outside' }).focus();

    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  test('Tab keeps focus on the dialog when it holds nothing focusable', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
          <h2 id="dialog-title">Title</h2>
          <p>no focusable children</p>
        </Modal>
      </>,
    );
    await waitForInitialFocus();
    screen.getByRole('button', { name: 'outside' }).focus();

    await user.tab();

    expect(document.activeElement).toBe(dialog());
  });
});

describe('closing', () => {
  test('Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal {...MODAL_PROPS} open onClose={onClose}>
        <DialogBody />
      </Modal>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  test('Escape still calls the latest onClose after a re-render', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Modal {...MODAL_PROPS} open onClose={first}>
        <DialogBody />
      </Modal>,
    );
    rerender(
      <Modal {...MODAL_PROPS} open onClose={second}>
        <DialogBody />
      </Modal>,
    );

    await user.keyboard('{Escape}');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  test('clicking the backdrop calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal {...MODAL_PROPS} open onClose={onClose}>
        <DialogBody />
      </Modal>,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  test('renders nothing while closed', () => {
    render(
      <Modal {...MODAL_PROPS} open={false} onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('dialog wiring', () => {
  test('marks itself as a modal dialog labelled by the given id', () => {
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );

    const el = dialog();
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('aria-labelledby')).toBe('dialog-title');
    expect(screen.getByRole('dialog', { name: 'Title' })).toBe(el);
  });

  test('the backdrop close control is outside the dialog, not a focus stop', async () => {
    const user = userEvent.setup();
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    const backdrop = screen.getByRole('button', { name: 'Close' });
    expect(dialog().contains(backdrop)).toBe(false);

    screen.getByRole('button', { name: 'third' }).focus();
    await user.tab();

    expect(document.activeElement).not.toBe(backdrop);
  });

  /**
   * Load-bearing: call sites render a desktop and a mobile layout side by side
   * and hide one with `hidden md:block` / `md:hidden`, so at any viewport half
   * the buttons in the dialog are display:none. They must not take focus.
   * (Tailwind classes don't apply under jsdom, hence the inline style — see the
   * getClientRects note in tests/setup-dom.ts.)
   */
  test('skips focusable elements inside a display:none subtree', async () => {
    const user = userEvent.setup();
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <h2 id="dialog-title">Title</h2>
        <div style={{ display: 'none' }}>
          <button type="button">mobile only</button>
        </div>
        <button type="button">desktop first</button>
        <button type="button">desktop last</button>
      </Modal>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'desktop first' }));
    });

    // The hidden button is also skipped by the wrap, not just by initial focus.
    screen.getByRole('button', { name: 'desktop last' }).focus();
    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'desktop first' }));
  });

  test('skips an aria-hidden element when choosing initial focus', async () => {
    render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <h2 id="dialog-title">Title</h2>
        {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: deliberately bad markup — the point is that Modal refuses to focus it */}
        <button type="button" aria-hidden="true">
          hidden
        </button>
        <button type="button">real</button>
      </Modal>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'real' }));
    });
  });
});

describe('background scroll lock', () => {
  test('locks body scroll while open and restores it on close', () => {
    const { rerender } = render(
      <Modal {...MODAL_PROPS} open={false} onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('');

    rerender(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal {...MODAL_PROPS} open={false} onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  test('restores a pre-existing overflow value rather than clearing it', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal {...MODAL_PROPS} open={false} onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );

    expect(document.body.style.overflow).toBe('scroll');
  });

  test('unmounting while open restores body scroll', () => {
    const { unmount } = render(
      <Modal {...MODAL_PROPS} open onClose={vi.fn()}>
        <DialogBody />
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();

    expect(document.body.style.overflow).toBe('');
  });
});

describe('focus return', () => {
  test('returns focus to whatever was focused before opening', async () => {
    const user = userEvent.setup();
    render(
      <ToggleHarness>
        <DialogBody />
      </ToggleHarness>,
    );
    const trigger = screen.getByRole('button', { name: 'open' });

    await user.click(trigger);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  test('does not steal focus back when the trigger has left the DOM', async () => {
    const user = userEvent.setup();

    function DisappearingTrigger() {
      const [open, setOpen] = useState(false);

      return (
        <>
          <button type="button">stable</button>
          {open ? null : (
            <button type="button" onClick={() => setOpen(true)}>
              open
            </button>
          )}
          <Modal {...MODAL_PROPS} open={open} onClose={() => setOpen(false)}>
            <DialogBody />
          </Modal>
        </>
      );
    }

    render(<DisappearingTrigger />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    await user.keyboard('{Escape}');

    // The trigger unmounted with the modal open, so there is nothing to restore
    // to; focus must not land on the unrelated 'stable' button.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'stable' }));
  });
});

describe('chained dialogs', () => {
  /**
   * Mirrors `content-planner/page.tsx`: the research modal is rendered *before*
   * the chooser, and `onOpenResearch` closes the chooser and opens research in a
   * single state update. The module-level `chainedDialogReturnFocus` in
   * `modal.tsx` exists solely to carry the original trigger across that handoff.
   */
  function ChainedHarness() {
    const [chooserOpen, setChooserOpen] = useState(false);
    const [researchOpen, setResearchOpen] = useState(false);

    return (
      <>
        <button type="button" onClick={() => setChooserOpen(true)}>
          open chooser
        </button>
        <Modal
          closeLabel="Close research"
          labelledBy="research-title"
          open={researchOpen}
          onClose={() => setResearchOpen(false)}
        >
          <h2 id="research-title">Research</h2>
          <button type="button">research action</button>
        </Modal>
        <Modal
          closeLabel="Close chooser"
          labelledBy="chooser-title"
          open={chooserOpen}
          onClose={() => setChooserOpen(false)}
        >
          <h2 id="chooser-title">Chooser</h2>
          <button
            type="button"
            onClick={() => {
              setChooserOpen(false);
              setResearchOpen(true);
            }}
          >
            research
          </button>
        </Modal>
      </>
    );
  }

  test('hands the original trigger across the chooser to research handoff', async () => {
    const user = userEvent.setup();
    render(<ChainedHarness />);
    const trigger = screen.getByRole('button', { name: 'open chooser' });

    await user.click(trigger);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'research' }));
    });

    // Chooser closes and research opens in one commit.
    await user.click(screen.getByRole('button', { name: 'research' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'research action' }));
    });
    expect(screen.getByRole('dialog')).toBe(screen.getByRole('dialog', { name: /Research/ }));

    // Closing the second dialog returns focus to the trigger that opened the
    // first one — not into the chooser, which is long gone.
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  test('locks background scroll continuously across the handoff', async () => {
    const user = userEvent.setup();
    render(<ChainedHarness />);

    await user.click(screen.getByRole('button', { name: 'open chooser' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: 'research' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('');
    });
  });
});
