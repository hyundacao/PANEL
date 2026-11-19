import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSuggestionListDismissal } from './suggestionListDismissal.ts';

const setup = () => {
  const document = new EventTarget();
  const input = { nodeType: 1 }, row = { nodeType: 1 }, outside = { nodeType: 1 };
  const container = { ownerDocument: document, contains: target => target === input || target === row || target === container, nodeType: 1 };
  let closed = 0;
  const release = bindSuggestionListDismissal(container, () => { closed++; });
  const send = (type, { touches = [], changedTouches = [], target = outside, key = '' } = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const points = values => values.map(([clientX, clientY, identifier = 1]) => ({ clientX, clientY, identifier }));
    Object.defineProperties(event, { target: { value: target }, touches: { value: points(touches) },
      changedTouches: { value: points(changedTouches) }, key: { value: key } });
    document.dispatchEvent(event);
    return event;
  };
  return { send, release, input, row, outside, container, closed: () => closed };
};

test('outside page drag does not dismiss at touchstart, input blur focus changes, movement or end', () => {
  const f = setup();
  assert.equal(f.send('touchstart', { touches: [[300, 200]] }).defaultPrevented, false);
  assert.equal(f.closed(), 0, 'do not close before classifying the gesture');
  f.send('focusin');
  assert.equal(f.closed(), 0);
  assert.equal(f.send('touchmove', { touches: [[300, 80]] }).defaultPrevented, false, 'page scroll remains native');
  f.send('touchend', { changedTouches: [[300, 80]] });
  assert.equal(f.closed(), 0);
  assert.equal(f.send('mousedown').defaultPrevented, false);
  f.send('focusin');
  assert.equal(f.closed(), 0, 'late Android mouse/focus compatibility events do not undo scroll detection');
  f.release();
});

test('a genuine outside tap dismisses only at touchend and never consumes the underlying button tap', () => {
  const f = setup();
  f.send('touchstart', { touches: [[300, 200]] });
  assert.equal(f.closed(), 0);
  f.send('touchmove', { touches: [[302, 198]] });
  assert.equal(f.send('touchend', { changedTouches: [[302, 198]] }).defaultPrevented, false);
  assert.equal(f.closed(), 1);
  f.send('mousedown');
  assert.equal(f.closed(), 1, 'compatibility mousedown does not dismiss a second time');
  f.release();
});

test('taps and scrolls inside the input or suggestion list never act as outside dismissals', () => {
  const f = setup();
  for (const target of [f.input, f.row, f.container]) {
    f.send('touchstart', { touches: [[20, 150]], target });
    f.send('focusin', { target });
    f.send('touchend', { changedTouches: [[20, 150]], target });
  }
  assert.equal(f.closed(), 0);
  f.send('touchstart', { touches: [[20, 150]], target: f.row });
  f.send('touchmove', { touches: [[20, 70]], target: f.row });
  f.send('touchend', { changedTouches: [[20, 70]], target: f.row });
  assert.equal(f.closed(), 0);
  f.release();
});

test('movement recorded only in touchend, horizontal drags and real scroll events are not taps', () => {
  const f = setup();
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchend', { changedTouches: [[300, 50]] });
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchmove', { touches: [[250, 200]] });
  f.send('touchend', { changedTouches: [[250, 200]] });
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('scroll');
  f.send('touchend', { changedTouches: [[300, 200]] });
  assert.equal(f.closed(), 0);
  f.release();
});

test('moving away and back to the starting point still counts as a drag', () => {
  const f = setup();
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchmove', { touches: [[300, 150]] });
  f.send('touchmove', { touches: [[300, 200]] });
  f.send('touchend', { changedTouches: [[300, 200]] });
  assert.equal(f.closed(), 0);
  f.release();
});

test('cancelled gestures, pinch zoom and mismatched touch identifiers do not dismiss', () => {
  const f = setup();
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchcancel');
  f.send('touchend', { changedTouches: [[300, 200]] });
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchstart', { touches: [[300, 200, 1], [200, 200, 2]] });
  f.send('touchend', { touches: [[300, 200, 1]], changedTouches: [[200, 200, 2]] });
  f.send('touchend', { changedTouches: [[300, 200, 1]] });
  f.send('touchstart', { touches: [[300, 200, 1], [200, 200, 2]] });
  f.send('focusin');
  f.send('touchend', { changedTouches: [[300, 200, 1], [200, 200, 2]] });
  f.send('touchstart', { touches: [[300, 200, 1]] });
  f.send('touchend', { changedTouches: [[300, 200, 2]] });
  assert.equal(f.closed(), 0);
  f.release();
});

test('mouse clicks and keyboard focus outside still dismiss while inside controls remain usable', () => {
  const f = setup();
  f.send('mousedown', { target: f.input });
  f.send('focusin', { target: f.row });
  assert.equal(f.closed(), 0);
  assert.equal(f.send('mousedown').defaultPrevented, false);
  assert.equal(f.closed(), 1);
  f.send('focusin');
  assert.equal(f.closed(), 2);
  f.release();
});

test('Tab after a touch allows deliberate keyboard focus dismissal, and Escape still closes', () => {
  const f = setup();
  f.send('touchstart', { touches: [[20, 150]], target: f.input });
  f.send('touchend', { changedTouches: [[20, 150]], target: f.input });
  f.send('keydown', { key: 'Tab', target: f.input });
  f.send('focusin');
  assert.equal(f.closed(), 1);
  f.send('keydown', { key: 'Escape', target: f.input });
  assert.equal(f.closed(), 2);
  f.release();
});

test('a fresh outside tap after a drag still dismisses, without a cooldown blocking new touches', () => {
  const f = setup();
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchmove', { touches: [[300, 100]] });
  f.send('touchend', { changedTouches: [[300, 100]] });
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchend', { changedTouches: [[300, 200]] });
  assert.equal(f.closed(), 1);
  f.release();
});

test('cleanup removes every listener and abandons any active gesture', () => {
  const f = setup();
  f.send('touchstart', { touches: [[300, 200]] });
  f.release();
  f.send('touchend', { changedTouches: [[300, 200]] });
  f.send('touchstart', { touches: [[300, 200]] });
  f.send('touchend', { changedTouches: [[300, 200]] });
  f.send('mousedown');
  f.send('focusin');
  f.send('keydown', { key: 'Escape' });
  assert.equal(f.closed(), 0);
});
