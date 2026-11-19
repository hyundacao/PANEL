const TAP_MOVEMENT_PX = 6;

// Native non-passive listeners also work in older Android browsers that chain
// touches on an overflowing popup to the page despite overscroll-behavior.
export const bindSuggestionListTouchScroll = (
  list: HTMLElement,
  onInteraction: (active: boolean) => void = () => undefined
) => {
  let gesture: {
    x: number; y: number; lastY: number; moved: boolean; button: HTMLButtonElement | null;
  } | null = null;
  let suppressMouseUntil = 0;

  const cancel = () => {
    if (!gesture) return;
    gesture = null;
    suppressMouseUntil = Date.now() + 600;
    onInteraction(false);
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) { cancel(); return; }
    const touch = event.touches[0];
    const button = (event.target as Element | null)?.closest?.('button') as HTMLButtonElement | null;
    gesture = {
      x: touch.clientX, y: touch.clientY, lastY: touch.clientY, moved: false,
      button: button && list.contains(button) ? button : null
    };
    suppressMouseUntil = 0;
    onInteraction(true);
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1) { cancel(); return; }
    const touch = event.touches[0];
    if (Math.abs(touch.clientX - gesture.x) > TAP_MOVEMENT_PX ||
        Math.abs(touch.clientY - gesture.y) > TAP_MOVEMENT_PX) gesture.moved = true;
    if (event.cancelable) event.preventDefault();
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.max(0, Math.min(max, list.scrollTop + gesture.lastY - touch.clientY));
    gesture.lastY = touch.clientY;
  };
  const end = (event: TouchEvent) => {
    if (!gesture || event.touches.length) return;
    const finished = gesture;
    gesture = null;
    if (event.cancelable) event.preventDefault();
    if (finished.moved) {
      suppressMouseUntil = Date.now() + 600;
    } else if (finished.button && list.contains(finished.button)) {
      // Canceled touchmove suppresses compatibility clicks, even after tiny tap jitter.
      finished.button.click();
    }
    onInteraction(false);
  };
  const ignoreSwipeClick = (event: MouseEvent) => {
    if (event.detail === 0 || Date.now() >= suppressMouseUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  list.addEventListener('touchstart', start, { passive: true });
  list.addEventListener('touchmove', move, { passive: false });
  list.addEventListener('touchend', end, { passive: false });
  list.addEventListener('touchcancel', cancel, { passive: true });
  list.addEventListener('mousedown', ignoreSwipeClick, true);
  list.addEventListener('click', ignoreSwipeClick, true);
  return () => {
    list.removeEventListener('touchstart', start);
    list.removeEventListener('touchmove', move);
    list.removeEventListener('touchend', end);
    list.removeEventListener('touchcancel', cancel);
    list.removeEventListener('mousedown', ignoreSwipeClick, true);
    list.removeEventListener('click', ignoreSwipeClick, true);
    if (gesture) { gesture = null; onInteraction(false); }
  };
};
