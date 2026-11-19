const TAP_MOVEMENT_PX = 6;
const TOUCH_COMPATIBILITY_MS = 600;

// Observe outside gestures without consuming page scroll or normal control clicks.
export const bindSuggestionListDismissal = (container: HTMLElement, dismiss: () => void) => {
  const document = container.ownerDocument;
  let gesture: { id: number; x: number; y: number; outside: boolean; moved: boolean; cancelled: boolean } | null = null;
  let ignoreCompatibilityUntil = 0;
  const outside = (target: EventTarget | null) => Boolean(target && 'nodeType' in target && !container.contains(target as Node));
  const rememberMovement = (touch?: Touch) => {
    if (!gesture || !touch) return;
    if (Math.abs(touch.clientX - gesture.x) > TAP_MOVEMENT_PX ||
        Math.abs(touch.clientY - gesture.y) > TAP_MOVEMENT_PX) gesture.moved = true;
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      if (gesture) gesture.cancelled = true;
      ignoreCompatibilityUntil = Infinity;
      return;
    }
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY,
      outside: outside(event.target), moved: false, cancelled: false };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1) gesture.cancelled = true;
    rememberMovement(Array.from(event.touches).find(touch => touch.identifier === gesture?.id));
  };
  const end = (event: TouchEvent) => {
    ignoreCompatibilityUntil = Date.now() + TOUCH_COMPATIBILITY_MS;
    if (!gesture) return;
    const ended = Array.from(event.changedTouches).find(touch => touch.identifier === gesture?.id);
    if (!ended) gesture.cancelled = true;
    rememberMovement(ended);
    if (event.touches.length) { gesture.cancelled = true; return; }
    const finished = gesture;
    gesture = null;
    if (finished.outside && !finished.moved && !finished.cancelled && outside(event.target)) dismiss();
  };
  const cancel = () => {
    gesture = null;
    ignoreCompatibilityUntil = Date.now() + TOUCH_COMPATIBILITY_MS;
  };
  const scroll = () => { if (gesture) gesture.moved = true; };
  const closeOutside = (event: Event) => {
    if (!gesture && Date.now() >= ignoreCompatibilityUntil && outside(event.target)) dismiss();
  };
  const keydown = (event: KeyboardEvent) => {
    // A deliberate keyboard focus change is not a delayed touch compatibility event.
    if (event.key === 'Tab') ignoreCompatibilityUntil = 0;
    if (event.key === 'Escape') dismiss();
  };
  document.addEventListener('touchstart', start, { capture: true, passive: true });
  document.addEventListener('touchmove', move, { capture: true, passive: true });
  document.addEventListener('touchend', end, { capture: true, passive: true });
  document.addEventListener('touchcancel', cancel, { capture: true, passive: true });
  document.addEventListener('scroll', scroll, { capture: true, passive: true });
  document.addEventListener('mousedown', closeOutside, true);
  document.addEventListener('focusin', closeOutside, true);
  document.addEventListener('keydown', keydown, true);
  return () => {
    document.removeEventListener('touchstart', start, { capture: true });
    document.removeEventListener('touchmove', move, { capture: true });
    document.removeEventListener('touchend', end, { capture: true });
    document.removeEventListener('touchcancel', cancel, { capture: true });
    document.removeEventListener('scroll', scroll, { capture: true });
    document.removeEventListener('mousedown', closeOutside, { capture: true });
    document.removeEventListener('focusin', closeOutside, { capture: true });
    document.removeEventListener('keydown', keydown, { capture: true });
    gesture = null;
  };
};
