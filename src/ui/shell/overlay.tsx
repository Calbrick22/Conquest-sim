import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Overlays as a stack (game-ui-ux: screen stack). Only the top overlay takes input: it traps
 * focus, Esc closes it, and focus returns to where it was when it closes. Base screens are routed
 * by the URL hash; overlays (pause, settings, confirmations, summaries) are modals on top.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open modals, newest last: only the top one handles Esc and Tab. */
const openModals: symbol[] = [];

export function anyModalOpen(): boolean {
  return openModals.length > 0;
}

/**
 * A modal dialog: focuses its first control (or `initialFocus`) on open, keeps Tab inside, closes
 * on Esc, and gives focus back on close. Render it conditionally; it manages its own focus.
 */
export function Modal({ title, onClose, children, className = '', labelledBy, wide = false }: { title?: string; onClose: () => void; children: ReactNode; className?: string; labelledBy?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const token = Symbol('modal');
    openModals.push(token);
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!box || openModals[openModals.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openModals.splice(openModals.indexOf(token), 1);
      before?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal panel ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? titleId : undefined)}>
        {title && (
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}

/** A yes/no confirmation. The safe choice ("Cancel") has focus first. */
export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel} className="confirm">
      <div className="modal-body">{body}</div>
      <div className="actions end">
        <button type="button" className="secondary" onClick={onCancel} data-autofocus data-testid="confirm-cancel">
          Cancel
        </button>
        <button type="button" className={danger ? 'danger' : ''} onClick={onConfirm} data-testid="confirm-ok">
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Ask for confirmation before running `action` (skipped when `when` is false). */
export function useConfirm() {
  const [pending, setPending] = useState<{ title: string; body: ReactNode; confirmLabel: string; danger?: boolean; action: () => void } | null>(null);
  const ask = useCallback((o: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; when?: boolean }, action: () => void) => {
    if (o.when === false) {
      action();
      return;
    }
    setPending({ ...o, action });
  }, []);
  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      {...(pending.danger ? { danger: true } : {})}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const a = pending.action;
        setPending(null);
        a();
      }}
    />
  ) : null;
  return { ask, dialog };
}
