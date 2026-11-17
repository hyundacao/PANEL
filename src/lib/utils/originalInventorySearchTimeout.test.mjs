import assert from 'node:assert/strict';
import test from 'node:test';
import { withOriginalInventorySearchTimeout } from './originalInventorySearchTimeout.ts';

test('hung search terminates with timeout and aborts the transport', async () => {
  let signal;
  await assert.rejects(withOriginalInventorySearchTimeout(value => {
    signal = value;
    return new Promise(() => {});
  },undefined,20),/SEARCH_TIMEOUT/);
  assert.equal(signal.aborted,true);
});

test('query cancellation aborts the old transport without waiting for its timeout', async () => {
  const parent = new AbortController();
  let signal;
  const pending = withOriginalInventorySearchTimeout(value => {
    signal = value;
    return new Promise(() => {});
  },parent.signal,10000);
  parent.abort(new Error('CHANGED_QUERY'));
  await assert.rejects(pending,/CHANGED_QUERY/);
  assert.equal(signal.aborted,true);
  await assert.rejects(withOriginalInventorySearchTimeout(()=>{throw new Error('Must not start');},parent.signal),/CHANGED_QUERY/);
});

test('quick results and failures retain their meaning and release timeout resources', async () => {
  const result = {items:[{name:'9203',indexCode:'IDX-1',indexCode2:'IDX-2'}]};
  assert.equal(await withOriginalInventorySearchTimeout(async()=>result,undefined,20),result);
  await assert.rejects(withOriginalInventorySearchTimeout(async()=>{throw new Error('OFFLINE');},undefined,20),/OFFLINE/);
  await assert.rejects(withOriginalInventorySearchTimeout(()=>{throw new Error('SYNC_ERROR');},undefined,20),/SYNC_ERROR/);
});
