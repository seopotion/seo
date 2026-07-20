'use client';

import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
let chainedDialogReturnFocus: HTMLElement | null = null;

export function PlannerDialog({
  children,
  className,
  closeLabel,
  labelledBy,
  onClose,
  open,
}: {
  children: ReactNode;
  className?: string;
  closeLabel: string;
  labelledBy: string;
  onClose: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  usePlannerDialogFocusManagement({ dialogRef, onClose, open });

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-stretch bg-slate-950/40 sm:place-items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 cursor-default"
        onMouseDown={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          'relative flex h-[100dvh] w-full flex-col bg-white shadow-lg sm:h-[min(90dvh,760px)] sm:max-w-5xl sm:rounded-lg sm:border sm:border-slate-200',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function usePlannerDialogFocusManagement({
  dialogRef,
  onClose,
  open,
}: {
  dialogRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  open: boolean;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previouslyFocused = chainedDialogReturnFocus?.isConnected
      ? chainedDialogReturnFocus
      : activeElement;
    const originalBodyOverflow = document.body.style.overflow;

    chainedDialogReturnFocus = null;
    document.body.style.overflow = 'hidden';

    function focusInitialElement() {
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const preferredElement = dialog.querySelector<HTMLElement>(
        '[data-planner-dialog-initial-focus]',
      );
      const focusTarget =
        preferredElement && isElementFocusable(preferredElement)
          ? preferredElement
          : (getFocusableElements(dialog)[0] ?? dialog);

      focusTarget.focus({ preventScroll: true });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const focusableElements = getFocusableElements(dialog);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const activeElement = document.activeElement;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!activeElement || !dialog.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    }

    const animationFrame = window.requestAnimationFrame(focusInitialElement);

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.body.style.overflow = originalBodyOverflow;
      document.removeEventListener('keydown', handleKeyDown);

      const anotherDialogOpen = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
      ).some((dialog) => dialog !== dialogRef.current);

      if (anotherDialogOpen) {
        chainedDialogReturnFocus = previouslyFocused;
        return;
      }

      if (dialogRef.current?.isConnected) {
        return;
      }

      window.setTimeout(() => {
        const anotherDialogOpen = document.querySelector('[role="dialog"][aria-modal="true"]');

        if (!anotherDialogOpen && previouslyFocused?.isConnected) {
          previouslyFocused.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, [dialogRef, open]);
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isElementFocusable,
  );
}

function isElementFocusable(element: HTMLElement) {
  return (
    !element.hasAttribute('disabled') &&
    element.getAttribute('aria-hidden') !== 'true' &&
    element.tabIndex !== -1 &&
    element.getClientRects().length > 0
  );
}
