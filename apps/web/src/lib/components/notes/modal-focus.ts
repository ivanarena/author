type SavedSiblingState = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

function focusableElements(node: HTMLElement): HTMLElement[] {
  return [
    ...node.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ].filter((element) => !element.hidden && element.getClientRects().length > 0);
}

export function modalFocus(node: HTMLElement): { destroy: () => void } {
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const layer = node.parentElement;
  const root = layer?.parentElement;
  const siblingStates: SavedSiblingState[] = [];
  if (root && layer) {
    for (const sibling of root.children) {
      if (sibling === layer || !(sibling instanceof HTMLElement)) continue;
      siblingStates.push({
        element: sibling,
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute('aria-hidden')
      });
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
  }

  const focusInitial = () => {
    const target =
      node.querySelector<HTMLElement>('[autofocus]') ??
      focusableElements(node)[0] ??
      node;
    target.focus({ preventScroll: true });
  };
  queueMicrotask(focusInitial);

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(node);
    if (!focusable.length) {
      event.preventDefault();
      node.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  node.addEventListener('keydown', handleKeydown);

  return {
    destroy() {
      node.removeEventListener('keydown', handleKeydown);
      for (const state of siblingStates) {
        state.element.inert = state.inert;
        if (state.ariaHidden === null)
          state.element.removeAttribute('aria-hidden');
        else state.element.setAttribute('aria-hidden', state.ariaHidden);
      }
      if (previousFocus?.isConnected) {
        queueMicrotask(() => previousFocus.focus({ preventScroll: true }));
      }
    }
  };
}
