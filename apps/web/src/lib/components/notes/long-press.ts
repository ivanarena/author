// Touch long-press as a context-menu gesture. iOS Safari never fires
// `contextmenu` on long-press, so menus that hold actions (such as Export
// manuscript) would otherwise be unreachable there. Android fires its own
// `contextmenu` too; both open the same menu, so that is harmless.

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

export type LongPressHandler = (point: {
  clientX: number;
  clientY: number;
}) => void;

export function longPress(node: HTMLElement, handler: LongPressHandler) {
  let onLongPress = handler;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };

  const down = (event: PointerEvent) => {
    // Any new press (touch, mouse or pen) ends a previous long-press, so its
    // click is never swallowed.
    fired = false;
    if (event.pointerType !== 'touch') return;
    cancel();
    start = { x: event.clientX, y: event.clientY };
    const point = { clientX: event.clientX, clientY: event.clientY };
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      onLongPress(point);
    }, LONG_PRESS_MS);
  };

  const move = (event: PointerEvent) => {
    if (!start) return;
    const distance = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y
    );
    if (distance > MOVE_TOLERANCE_PX) cancel();
  };

  // The tap that ends a long-press must neither run the button's action nor
  // reach the window click handler that closes context menus.
  const click = (event: MouseEvent) => {
    if (!fired) return;
    fired = false;
    event.preventDefault();
    event.stopPropagation();
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', click, true);

  return {
    update(next: LongPressHandler) {
      onLongPress = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', click, true);
    }
  };
}
