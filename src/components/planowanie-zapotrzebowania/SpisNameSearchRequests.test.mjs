import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';

const require=createRequire(import.meta.url);
const ts=require('typescript');
const source=readFileSync(new URL('./SpisRzeczywisty.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('SpisRzeczywisty.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const definitions=new Map();
let optionsText;
let inputClickText;
let inputBlurText;
function visit(node){
  if(ts.isVariableDeclaration(node)&&node.initializer) definitions.set(node.name.getText(ast),node.initializer.getText(ast));
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useQuery'){
    const options=node.arguments[0];
    if(options?.getText(ast).includes("queryKey: ['spis-oryginalow-catalog-search'")) optionsText=options.getText(ast);
  }
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='Input'&&
    node.attributes.properties.some(property=>property.name?.getText(ast)==='ref'&&property.initializer?.getText(ast)==='{inputRef}')){
    inputClickText=node.attributes.properties.find(property=>property.name?.getText(ast)==='onClick')?.initializer.expression.getText(ast);
    inputBlurText=node.attributes.properties.find(property=>property.name?.getText(ast)==='onBlur')?.initializer.expression.getText(ast);
  }
  ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(optionsText);
const compile=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const options=(query,fetcher,{debounced=query,open=true,counted=[]}={})=>{
  const mod={exports:{}};
  vm.runInNewContext(compile(`const retryOriginalInventoryNameSearch=${definitions.get('retryOriginalInventoryNameSearch')}; module.exports=(${optionsText});`),{
    module:mod,query,debouncedQuery:debounced,normalizedQuery:query.toLowerCase(),normalizedDebouncedQuery:debounced.toLowerCase(),
    remoteSearchEnabled:query.replace(/\s/g,'').length>=2,showSuggestions:open,priorityNames:counted,
    searchOriginalInventoryCatalog:fetcher,SPIS_SEARCH_MIN_LENGTH:2,SPIS_SEARCH_SERVER_LIMIT:24
  });
  return mod.exports;
};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const item={id:'9203',name:'KONCENTRAT SY9203',indexCode:'M-1-BAR',indexCode2:'INDEX-2-9203'};

test('a transient failure retries once without deleting and typing the same query again',async()=>{
  const client=new QueryClient();
  let calls=0;
  try{
    const result=await client.fetchQuery(options('9203',async()=>{
      if(++calls===1) throw new TypeError('Failed to fetch');
      return [item];
    }));
    assert.equal(result[0].id,'9203');
    assert.equal(calls,2);
  }finally{client.clear();}
});

test('permission, session and cancellation errors are not automatically retried',async()=>{
  const retry=options('9203',async()=>[]).retry;
  for(const code of ['UNAUTHORIZED','SESSION_EXPIRED','FORBIDDEN','PASSWORD_CHANGE_REQUIRED','PAYLOAD_TOO_LARGE','SEARCH_CANCELLED','MIGRATION_REQUIRED_TEST']){
    assert.equal(retry(0,new Error(code)),false,code);
  }
  const aborted=new Error('aborted');aborted.name='AbortError';
  assert.equal(retry(0,aborted),false);
  assert.equal(retry(0,new Error('SEARCH_TIMEOUT')),true);
  assert.equal(retry(1,new Error('SEARCH_TIMEOUT')),false);
});

test('a new current key cancels an old request immediately, before the next debounce finishes',async()=>{
  const client=new QueryClient();
  let oldSignal,calls=0;
  const fetcher=(query,limit,signal)=>{
    calls++;
    if(query==='hosta'){
      oldSignal=signal;
      return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('CANCELLED')),{once:true}));
    }
    return Promise.resolve([item]);
  };
  const observer=new QueryObserver(client,options('hosta',fetcher));
  const unsubscribe=observer.subscribe(()=>{});
  try{
    assert.equal(oldSignal.aborted,false);
    observer.setOptions(options('9203',fetcher,{debounced:'hosta'}));
    assert.equal(oldSignal.aborted,true);
    assert.equal(observer.getCurrentResult().data,undefined);
    assert.equal(calls,1,'new request waits for debounce, but old one is already canceled');
    const current=options('9203',fetcher);
    observer.setOptions(current);
    await client.fetchQuery(current);
    assert.equal(observer.getCurrentResult().data[0].id,'9203');
    assert.equal(calls,2);
  }finally{unsubscribe();client.clear();}
});

test('an exact cached current query is available immediately while debounce still holds older text',()=>{
  const client=new QueryClient();
  let calls=0;
  const fetcher=async()=>{calls++;return [];};
  const current=options('9203',fetcher,{debounced:'hosta'});
  client.setQueryData(current.queryKey,[item]);
  const observer=new QueryObserver(client,current);
  const unsubscribe=observer.subscribe(()=>{});
  try{
    assert.equal(observer.getCurrentResult().data[0].id,'9203');
    assert.equal(observer.getCurrentResult().isPending,false);
    assert.equal(calls,0);
    assert.notDeepEqual(current.queryKey,options('9203',fetcher,{counted:['OTHER DAY']}).queryKey);
  }finally{unsubscribe();client.clear();}
});

test('the search attempts real network access even if a browser offline event left the global manager paused',async()=>{
  const client=new QueryClient();
  onlineManager.setOnline(false);
  let calls=0;
  try{
    const result=await client.fetchQuery(options('9203',async()=>{calls++;return [item];}));
    assert.equal(result[0].id,'9203');
    assert.equal(calls,1);
  }finally{onlineManager.setOnline(true);client.clear();}
});

test('a cached empty result does not block a new search for the same text on reopening',async()=>{
  const client=new QueryClient();
  let calls=0;
  const fetcher=async()=>{calls++;return [item];};
  const opened=options('9203',fetcher);
  client.setQueryData(opened.queryKey,[]);
  const observer=new QueryObserver(client,options('9203',fetcher,{open:false}));
  const unsubscribe=observer.subscribe(()=>{});
  try{
    assert.equal(calls,0);
    observer.setOptions(opened);
    const result=await client.fetchQuery(opened);
    assert.equal(calls,1);
    assert.equal(result[0].id,'9203');
  }finally{unsubscribe();client.clear();}
});

test('closed or too-short searches do not fetch; reopening a failed same query fetches without editing text',async()=>{
  const client=new QueryClient();
  let calls=0,fail=true;
  const fetcher=async()=>{calls++;if(fail)throw new Error('FORBIDDEN');return [item];};
  const closed=options('9203',fetcher,{open:false});
  const observer=new QueryObserver(client,closed);
  const unsubscribe=observer.subscribe(()=>{});
  try{
    await flush();assert.equal(calls,0);
    observer.setOptions(options('9',fetcher));
    await flush();assert.equal(calls,0);
    const opened=options('9203',fetcher);
    observer.setOptions(opened);
    await assert.rejects(client.fetchQuery(opened),/FORBIDDEN/);
    assert.equal(calls,1);
    observer.setOptions(closed);
    fail=false;
    observer.setOptions(opened);
    await client.fetchQuery(opened);
    assert.equal(calls,2);
    assert.equal(observer.getCurrentResult().data[0].id,'9203');
  }finally{unsubscribe();client.clear();}
});

test('a completed empty query has a visible state instead of silently removing the dropdown',()=>{
  const mod={exports:{}};
  vm.runInNewContext(compile(`const remoteResultsPending=${definitions.get('remoteResultsPending')};
    const remoteResultsFailed=${definitions.get('remoteResultsFailed')};
    const remoteResultsEmpty=${definitions.get('remoteResultsEmpty')};
    const suggestionsOpen=${definitions.get('suggestionsOpen')};
    module.exports={remoteResultsPending,remoteResultsFailed,remoteResultsEmpty,suggestionsOpen};`),{
    module:mod,remoteSearchEnabled:true,isPending:false,isFetching:false,isSuccess:true,isError:false,
    showSuggestions:true,suggestions:[]
  });
  assert.equal(mod.exports.remoteResultsEmpty,true);
  assert.equal(mod.exports.suggestionsOpen,true);
  assert.equal(mod.exports.remoteResultsPending,false);
  assert.match(source,/Brak pasujących kartotek\./);
  assert.match(source,/onClick=\{\(\) => \{\s*setShowSuggestions\(true\)/);
});

test('tapping an already focused field with an empty result retries without requiring any edit',()=>{
  assert.ok(inputClickText);
  const mod={exports:{}};
  let open=false,calls=0;
  vm.runInNewContext(compile(`module.exports=${inputClickText};`),{
    module:mod,setShowSuggestions:value=>{open=value;},
    remoteSearchEnabled:true,isSuccess:true,remoteCatalogSuggestions:[],refetch:options=>{
      assert.equal(options.cancelRefetch,false,'reuse a request already started by focus');
      calls++;return Promise.resolve();
    }
  });
  mod.exports();
  assert.equal(open,true);
  assert.equal(calls,1);
});

test('the actual input blur commits text but never hides the list or schedules a delayed dismissal',()=>{
  assert.ok(inputBlurText);
  const mod={exports:{}};
  const commits=[];
  vm.runInNewContext(compile(`module.exports=${inputBlurText};`),{
    module:mod,queryRef:{current:'WKRET 9203'},onCommit:value=>commits.push(value),
    setShowSuggestions:()=>assert.fail('blur must not dismiss during page scrolling'),
    setTimeout:()=>assert.fail('a delayed blur timer must not race a native touch gesture')
  });
  mod.exports();
  assert.deepEqual(commits,['WKRET 9203']);
});
