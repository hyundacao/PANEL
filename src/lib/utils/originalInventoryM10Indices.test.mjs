import assert from 'node:assert/strict';
import test from 'node:test';
import {linkOriginalInventoryM10Indices} from './originalInventoryM10Indices.ts';
import {searchOriginalInventorySpisSuggestions} from './originalInventorySpisSearch.ts';

const pair = () => [
  {id:'primary',name:'TRAY HANDLE ASSEMBLY WELDED COST IRON',unit:'szt.',warehouseCode:'M-10',indexCode:'M-10-PWY-BSHL-10008'},
  {id:'secondary',name:'TRAY HANDLE ASSEMBLY WELDED COST IRON',unit:'szt.',warehouseCode:'M-10',indexCode:'M-10-8001236303'}
];
test('confirmed M-10 legacy pairs expose PWY as index 1 and the full M-10-800 number as index 2', () => {
  for (const input of [pair(),pair().reverse()]) {
    const before = JSON.stringify(input);
    const linked = linkOriginalInventoryM10Indices(input);
    assert.equal(linked.length,input.length);
    assert.deepEqual(linked.map(row=>row.id),input.map(row=>row.id));
    assert.equal(JSON.stringify(input),before);
    for (const row of linked) {
      assert.equal(row.indexCode,'M-10-PWY-BSHL-10008');
      assert.equal(row.indexCode2,'M-10-8001236303');
      assert.deepEqual(new Set(row.catalogIds),new Set(['primary','secondary']));
    }
    assert.deepEqual(linkOriginalInventoryM10Indices(linked),linked);
    for (const query of ['TRAY WELDED COST','M-10-PWY-BSHL-10008','M-10-8001236303','8001236303']) {
      const choices = searchOriginalInventorySpisSuggestions(linked,query,[],24);
      assert.equal(choices.length,1,query);
      assert.equal(choices[0].indexCode2,'M-10-8001236303');
    }
  }
});

test('different names, units, warehouses and unconfirmed index formats are not linked', () => {
  for (const patch of [{name:'OTHER TRAY'},{unit:'kg'},{warehouseCode:'M-11'},
    {indexCode:'M-11-8001236303'},{indexCode:'M-10-9001972083'},{indexCode:'M-10-A22154703'},
    {indexCode2:'OTHER EXPLICIT SECOND INDEX'}]) {
    const items = pair();items[1]={...items[1],...patch};
    assert.deepEqual(linkOriginalInventoryM10Indices(items),items);
  }
  for (const extra of [
    {...pair()[0],id:'primary-other',indexCode:'M-10-PWY-BSHL-10009'},
    {...pair()[1],id:'secondary-other',indexCode:'M-10-8001236304'}
  ]) {
    const items = [...pair(),extra];
    assert.deepEqual(linkOriginalInventoryM10Indices(items),items);
  }
});
