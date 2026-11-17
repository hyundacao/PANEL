import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSuggestionListTouchScroll } from './suggestionListTouchScroll.ts';

const setup = () => {
  let taps = 0;
  const interactions = [];
  const button = { closest: () => button, click: () => { taps++; } };
  class List extends EventTarget {
    scrollTop = 0;
    scrollHeight = 1000;
    clientHeight = 200;
    contains(target) { return target === button; }
  }
  const list = new List();
  const release = bindSuggestionListTouchScroll(list, active => interactions.push(active));
  const send = (type, points = [], target = button, detail = 1) => {
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.defineProperties(event, {
      touches: { value: points.map(([clientX, clientY]) => ({clientX,clientY})) },
      target: { value: target }, detail: { value: detail }
    });
    list.dispatchEvent(event);
    return event;
  };
  return { list, button, interactions, release, send, taps: () => taps };
};

test('single-finger vertical drag scrolls the list and prevents the page default', () => {
  const f = setup();
  f.send('touchstart', [[30,180]]);
  assert.equal(f.send('touchmove', [[30,80]]).defaultPrevented, true);
  assert.equal(f.list.scrollTop, 100);
  f.send('touchmove', [[30,110]]);
  assert.equal(f.list.scrollTop, 70);
  assert.equal(f.send('touchend').defaultPrevented, true);
  assert.equal(f.taps(), 0);
  assert.deepEqual(f.interactions, [true,false]);
  f.release();
});

test('top and bottom edges never hand a drag to the page, even without CSS overscroll support', () => {
  const f = setup();
  f.send('touchstart', [[30,100]]);
  assert.equal(f.send('touchmove', [[30,170]]).defaultPrevented, true);
  assert.equal(f.list.scrollTop,0);
  f.send('touchend');
  f.list.scrollTop=800;
  f.send('touchstart', [[30,170]]);
  assert.equal(f.send('touchmove', [[30,40]]).defaultPrevented,true);
  assert.equal(f.list.scrollTop,800);
  f.send('touchend');
  assert.equal(f.taps(),0);
  f.release();
});

test('a tap and a tap with small finger jitter activate exactly one existing button click', () => {
  const f=setup();
  f.send('touchstart',[[20,100]]);
  f.send('touchend');
  assert.equal(f.taps(),1);
  f.send('touchstart',[[20,100]]);
  f.send('touchmove',[[22,97]]);
  f.send('touchend');
  assert.equal(f.taps(),2);
  f.release();
});

test('a swipe suppresses delayed compatibility mouse events but the next tap and keyboard click remain usable', () => {
  const f=setup();
  f.send('touchstart',[[20,170]]);
  f.send('touchmove',[[20,50]]);
  f.send('touchend');
  assert.equal(f.send('mousedown').defaultPrevented,true);
  assert.equal(f.send('click').defaultPrevented,true);
  assert.equal(f.send('click',[],f.button,0).defaultPrevented,false);
  f.send('touchstart',[[20,100]]);
  f.send('touchend');
  assert.equal(f.taps(),1);
  assert.equal(f.send('mousedown').defaultPrevented,false);
  f.release();
});

test('cancel, multi-touch, removed rows and touches on blank list space never choose a material', () => {
  const f=setup();
  f.send('touchstart',[[20,100]]);
  f.send('touchcancel');
  f.send('touchend');
  f.send('touchstart',[[20,100]]);
  f.send('touchstart',[[20,100],[50,100]]);
  assert.equal(f.send('touchmove',[[20,90],[60,90]]).defaultPrevented,false);
  f.send('touchend');
  const removed={closest:()=>removed,click:()=>{throw new Error('Removed row chosen');}};
  f.send('touchstart',[[20,100]],removed);
  f.send('touchend');
  f.send('touchstart',[[20,100]],{});
  f.send('touchend');
  assert.equal(f.taps(),0);
  f.release();
});

test('short lists consume vertical gestures and cleanup removes all handlers', () => {
  const f=setup();
  f.list.scrollHeight=100;
  f.send('touchstart',[[20,120]]);
  assert.equal(f.send('touchmove',[[20,20]]).defaultPrevented,true);
  assert.equal(f.list.scrollTop,0);
  f.release();
  assert.deepEqual(f.interactions,[true,false]);
  f.send('touchstart',[[20,120]]);
  assert.equal(f.send('touchmove',[[20,20]]).defaultPrevented,false);
  f.send('touchend');
  assert.equal(f.taps(),0);
});
