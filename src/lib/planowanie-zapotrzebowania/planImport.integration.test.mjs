import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as imports from './planImport.ts';

const pageFile = process.env.PLANNING_TEST_PAGE_PATH || fileURLToPath(new URL('../../app/(main)/planowanie-zapotrzebowania/page.tsx', import.meta.url));
const require = createRequire(pageFile);
const ts = require('typescript');
const source = readFileSync(pageFile,'utf8');
const ast = ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const directQuantityEditing = source.includes('const updatePlanQuantity =');
const names = ['uid','numberValue','normalize','splitProductFields','stationKey','applyStationMappings','clonePlanItems','documentStatusLabel','parseStoredState','parsePlanRows','planItemSignature',
  'handleWorkbook','importSelectedSheet','selectPlanningArea',directQuantityEditing ? 'updatePlanQuantity' : 'applyQuantityCorrection','undoLastCorrection','scopeForItem','itemProductionQty','createOrRefreshPickingDocument','changePickingDocumentStatus','deriveReturnsForDate'];
if (directQuantityEditing) names.push('updatePlanNorm');
const definitions = new Map();
const areaCalculationNames = ['technologyForItem','materialsForItem','demandByArea','sharedAreaIds','materialSupply','requirementsForArea'];
const areaCalculationDefinitions = new Map();
function visit(node) {
  if(ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) definitions.set(node.name.getText(ast),`const ${node.getText(ast)};`);
  if(ts.isVariableDeclaration(node) && areaCalculationNames.includes(node.name.getText(ast))) areaCalculationDefinitions.set(node.name.getText(ast),`const ${node.getText(ast)};`);
  ts.forEachChild(node,visit);
}
visit(ast);
assert.equal(definitions.size,names.length, `Missing source functions: ${names.filter(name=>!definitions.has(name)).join(', ')}`);
const compiled = ts.transpileModule([...definitions.values()].join('\n')+'\nObject.assign(exports,{'+names.join(',')+'});',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const domainFile=fileURLToPath(new URL('./domain.ts',new URL('file:///'+pageFile.replaceAll('\\','/').split('/src/')[0]+'/src/lib/planowanie-zapotrzebowania/')));
const domain={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync(domainFile,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,domain);
const rows=[['Lp.','','Ilość','ST.','Norma','','Uwagi'],['1','LEFT + RIGHT (A100, A200)','L - 3 594 P - 3 775','WTR 34',1400],['2','HOUSING (B100)','','WTR 40',612],['3','Unknown (C100)','DO RANA','WTR 20',1400]];

function setup() {
  const messages=[];
  const ctx=vm.createContext({exports:{},...imports,...domain.exports,
    state:{plan:[],technologies:[],archive:[],planVersions:[],documents:[],quantityCorrections:[],stationMappings:[],selectedPlanDate:'2026-08-31',selectedAreaId:'hala-2',dailyPlans:{},returnStatuses:{},areas:[],calculationMode:'all',horizonShifts:3.5},
    pending:{fileName:'test.xlsx',purpose:'plan',workbook:{SheetNames:['Plan'],Sheets:{Plan:{rows}}}},sheetName:'Plan',currentUserName:'Test',quantityInputs:{},readOnly:false,
    XLSX:{read:(data)=>data,utils:{sheet_to_json:(sheet)=>sheet.rows,decode_range:()=>({s:{r:0}})}},
    flash:(message)=>messages.push(message),nowLabel:()=>new Date().toISOString(),localDateKey:()=>'2026-08-31',formatPlanDate:(date)=>date,
    mergeAreas:(areas)=>areas,emptyState:()=>({plan:[],technologies:[]}),cloneMaterials:(items)=>JSON.parse(JSON.stringify(items)),technologyForItem:()=>undefined,
    materialsForItem:()=>[{code:'MAT',unit:'kg',usage:1}],materialKey:()=> 'MAT',requirementsForArea:()=>[]
  });
  ctx.updateState=(update)=>{ctx.state=update(ctx.state);};
  ctx.setState=(update)=>{ctx.state=update(ctx.state);};
  ctx.setExpandedPlan=()=>{};
  ctx.setExpandedCalculation=()=>{};
  ctx.setQuantityInputs=(update)=>{ctx.quantityInputs=update(ctx.quantityInputs);};
  ctx.setPending=(value)=>{ctx.pending=value;};
  ctx.setLastPlanWorkbook=(value)=>{ctx.lastPlanWorkbook=value;};
  ctx.setSheetName=(value)=>{ctx.sheetName=value;};
  ctx.setShowChanges=()=>{};
  vm.runInContext(compiled,ctx);
  return {ctx,messages,...ctx.exports};
}

const setQuantity = (h,item,value) => {
  if(directQuantityEditing) h.updatePlanQuantity(item.id,value,'edit-'+item.id);
  else { h.ctx.quantityInputs[item.id]=String(value); h.applyQuantityCorrection(item,'exact'); }
};

test('uploading a plan waits for card selection and imports only that card',async()=>{
  const h=setup();
  const workbook={SheetNames:['First','Selected','Last'],Sheets:{
    First:{rows:[rows[0],['1','FIRST (F100)',10,'WTR 1',100]]},
    Selected:{rows:[rows[0],['1','SELECTED (S100)',20,'WTR 2',200]]},
    Last:{rows:[rows[0],['1','LAST (L100)',30,'WTR 3',300]]}
  }};
  await h.handleWorkbook({name:'plans.xlsx',arrayBuffer:async()=>workbook},'plan');
  assert.equal(h.ctx.sheetName,'');
  h.importSelectedSheet();
  assert.equal(h.ctx.state.plan.length,0);
  h.ctx.sheetName='Selected';
  h.importSelectedSheet();
  assert.equal(h.ctx.state.plan.length,1);
  assert.equal(h.ctx.state.plan[0].sourceDetail,'SELECTED (S100)');
  assert.equal(h.ctx.state.planSheet,'Selected');
  assert.equal(h.ctx.pending,null);
  assert.equal(h.ctx.lastPlanWorkbook.workbook,workbook);
});

test('update preselects the current card only if it exists in the new workbook',async()=>{
  const h=setup();
  const file={name:'update.xlsx',arrayBuffer:async()=>({SheetNames:['Plan','Other'],Sheets:{Plan:{rows},Other:{rows:[]}}})};
  await h.handleWorkbook(file,'plan','Plan');
  assert.equal(h.ctx.sheetName,'Plan');
  assert.equal(h.ctx.state.plan.length,0);
  await h.handleWorkbook(file,'plan','Missing');
  assert.equal(h.ctx.sheetName,'');
});

test('selected zone drives real material calculations and separate picking documents',()=>{
  const h=setup(); h.importSelectedSheet();
  const base={...h.ctx.state.plan[0],quantityStatus:'parsed',sourceQuantity:'100',technologyId:'tech',workingMaterials:null,totalQty:100,remainingQty:100,scopeMode:'global'};
  h.ctx.state.plan=[
    {...base,id:'h1',areaId:'hala-1'},
    {...base,id:'emergency',areaId:'hala-1',planGroup:'emergency',totalQty:50,remainingQty:50},
    {...base,id:'planned',areaId:'hala-1',planGroup:'planned',included:false},
    {...base,id:'h2',areaId:'hala-2',totalQty:200,remainingQty:200},
    {...base,id:'unassigned',areaId:''}
  ];
  h.ctx.state.areas=[{id:'hala-1',name:'Hala 1'},{id:'hala-2',name:'Hala 2'}];
  h.ctx.state.inventory=[];
  h.ctx.state.technologies=[{id:'tech',materials:[{code:'MAT',name:'Material',category:'Tworzywo',unit:'kg',usage:2}]}];
  h.ctx.needsMaterialBalances=true;
  h.ctx.documentLedger=new Map();
  h.ctx.CATEGORY_ORDER=new Map();
  assert.equal(areaCalculationDefinitions.size,areaCalculationNames.length);
  const code=ts.transpileModule('(()=>{'+[...areaCalculationDefinitions.values()].join('\n')+';return requirementsForArea;})()',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  h.ctx.requirementsForArea=vm.runInContext(code,h.ctx);
  const planBefore=JSON.stringify(h.ctx.state.plan);
  h.selectPlanningArea('hala-1');
  const requirements=h.ctx.requirementsForArea(h.ctx.state.selectedAreaId);
  assert.equal(requirements[0].demand,300);
  assert.equal(requirements[0].toIssue,300);
  assert.deepEqual(Array.from(requirements[0].sources,(source)=>source.planItemId),['h1','emergency']);
  h.createOrRefreshPickingDocument();
  assert.equal(h.ctx.state.documents[0].areaId,'hala-1');
  assert.equal(h.ctx.state.documents[0].rows[0].demand,300);
  const currentVersion=h.ctx.state.planVersions[0];
  h.ctx.state.planVersions=[
    {...currentVersion,id:'newest',versionNo:2,status:'draft'},
    {...currentVersion,status:'active'}
  ];
  h.ctx.state.activePlanVersionId=currentVersion.id;
  h.selectPlanningArea('hala-2');
  h.createOrRefreshPickingDocument();
  assert.equal(h.ctx.state.documents.length,2);
  assert.equal(h.ctx.state.documents[0].areaId,'hala-2');
  assert.equal(h.ctx.state.documents[0].rows[0].demand,400);
  assert.equal(h.ctx.state.documents[0].planVersionId,'newest');
  assert.equal(h.ctx.state.documents[0].planVersionNo,2);
  assert.equal(h.ctx.state.documents[1].areaId,'hala-1');
  assert.equal(h.ctx.state.documents[1].planVersionId,currentVersion.id);
  assert.equal(JSON.stringify(h.ctx.state.plan),planBefore);
});

test('reload chooses latest version without changing plan data or historical documents',()=>{
  const h=setup(); h.importSelectedSheet();
  const old=h.ctx.state.planVersions[0];
  const documents=[{id:'historical',planVersionId:old.id,planVersionNo:1,status:'issued',rows:[]}];
  const state={...h.ctx.state,activePlanVersionId:old.id,documents,planVersions:[
    {...old,status:'active'},
    {...old,id:'latest',versionNo:2,status:'ready'},
    {...old,id:'other-day',versionNo:3,planDate:'2026-09-01',status:'active'}
  ]};
  const restored=h.parseStoredState(state);
  assert.equal(restored.activePlanVersionId,'latest');
  assert.equal(JSON.stringify(restored.plan),JSON.stringify(state.plan));
  assert.equal(JSON.stringify(restored.documents),JSON.stringify(documents));
  assert.equal(restored.planVersions.length,3);
});

const productLabels = [
  { raw:'T27SC1R LID HEX NUPS WELDED (MUCELL) 303022445', name:'T27SC1R LID HEX NUPS WELDED (MUCELL)', index:'303022445' },
  { raw:'DOCKING STATION SET MUH NG (8001382818) (CARRIER PART BASIS STATION)', name:'DOCKING STATION SET MUH NG (CARRIER PART BASIS STATION)', index:'8001382818' },
  { raw:'LEFT + RIGHT (A28963702, A28963701 )', name:'LEFT + RIGHT', index:'A28963702, A28963701' },
  { raw:'DOOR END (R4 600) WHITE (8001053776)', name:'DOOR END (R4 600) WHITE', index:'8001053776' },
  { raw:'HOUSING (1.605.806.6AP)', name:'HOUSING', index:'1.605.806.6AP' },
  { raw:'LID (M-10-8001238076)', name:'LID', index:'M-10-8001238076' }
];

for (const expected of productLabels) test(`separates product label without discarding qualifiers: ${expected.index}`,()=>{
  const h=setup();
  for(const [name,index] of [[expected.raw,expected.raw],[expected.raw,''],['',expected.raw],[expected.raw,expected.index],[expected.name,expected.raw],[expected.name,expected.index]]) {
    const result=h.splitProductFields(name,index);
    assert.deepEqual({...result},{name:expected.name,index:expected.index});
    assert.deepEqual({...h.splitProductFields(result.name,result.index)},{...result},'reopening must be idempotent');
  }
});

test('does not guess indices from short model numbers, descriptive brackets or ambiguous groups',()=>{
  const h=setup();
  for(const raw of ['DOOR END R4 600','MATERIAL PA66','LID (R4 600)','BOX (ROZMIAR 500)','PART (1234567) (7654321)']) {
    assert.deepEqual({...h.splitProductFields(raw,raw)},{name:raw,index:raw});
  }
  const name=productLabels[1].raw;
  assert.deepEqual({...h.splitProductFields(name,'EXPLICIT-999')},{name,index:'EXPLICIT-999'},'keep an independent explicit index');
});

test('actual import separates both screenshot labels and preserves original source text and both rows',()=>{
  const h=setup();
  h.ctx.pending.workbook.Sheets.Plan.rows=[rows[0],...productLabels.slice(0,2).map((product,i)=>[String(i+1),product.raw,120,`WTR ${i+1}`,100,'','Original note'])];
  h.importSelectedSheet();
  assert.equal(h.ctx.state.plan.length,2);
  h.ctx.state.plan.forEach((item,i)=>{
    assert.equal(item.index,productLabels[i].index);
    assert.equal(item.name,productLabels[i].name);
    assert.equal(item.sourceDetail,productLabels[i].raw);
    assert.equal(item.notes,'Original note');
    assert.equal(item.totalQty,120);
  });
});

test('reopening repairs legacy duplicate labels in daily plans, versions, archive and technologies without reimport',()=>{
  const h=setup(); h.importSelectedSheet();
  const product=productLabels[1];
  const legacy={...h.ctx.state.plan[0],name:product.raw,index:product.raw,remainingQty:37,shiftNorm:123,technologyId:'tech-kept',workingMaterials:[{id:'mat-kept',usage:0.15}],manualOverride:true,notes:'Keep this note',sourceDetail:product.raw};
  const state={...h.ctx.state,plan:[legacy],dailyPlans:{'2026-08-31':[legacy],'2026-08-30':[legacy]},planVersions:[{...h.ctx.state.planVersions[0],items:[legacy]}],archive:[{id:'archive-kept',status:'suspended',planItem:legacy}],technologies:[{id:'tech-kept',productName:product.raw,productIndex:product.raw,shiftNorm:123,materials:legacy.workingMaterials}]};
  const reloaded=h.parseStoredState(JSON.parse(JSON.stringify(state)));
  for(const item of [reloaded.plan[0],reloaded.dailyPlans['2026-08-31'][0],reloaded.dailyPlans['2026-08-30'][0],reloaded.planVersions[0].items[0],reloaded.archive[0].planItem]) {
    assert.equal(item.name,product.name);
    assert.equal(item.index,product.index);
    for(const key of ['id','runId','remainingQty','totalQty','shiftNorm','technologyId','manualOverride','notes','sourceDetail']) assert.equal(item[key],legacy[key],key);
    assert.deepEqual(JSON.parse(JSON.stringify(item.workingMaterials)),legacy.workingMaterials);
  }
  assert.equal(reloaded.technologies[0].productName,product.name);
  assert.equal(reloaded.technologies[0].productIndex,product.index);
  assert.equal(reloaded.technologies[0].id,'tech-kept');
  assert.equal(state.plan[0].name,product.raw,'do not mutate the original state');
});

test('actual import handler retains every row, source text and version snapshot',()=>{
  const h=setup(); h.importSelectedSheet();
  assert.equal(h.ctx.state.plan.length,3);
  assert.equal(h.ctx.state.planVersions[0].items.length,3);
  assert.equal(h.ctx.state.plan[0].totalQty,7369);
  assert.equal(h.ctx.state.plan[0].sourceQuantity,rows[1][2]);
  assert.equal(h.ctx.state.plan[1].quantityStatus,'missing');
  assert.equal(h.ctx.state.plan[2].quantityStatus,'unrecognized');
  assert.match(h.messages.at(-1),/3 pozycji/);
});

test('first import is a baseline and only later additions are marked as new',()=>{
  const h=setup();
  const originalPending=h.ctx.pending;
  h.importSelectedSheet();
  assert.equal(h.ctx.state.planVersions[0].differences.length,0);
  h.ctx.pending={
    ...originalPending,
    workbook:{Sheets:{Plan:{rows:[...rows,['4','New detail (D100)',100,'WTR 1',100]]}}}
  };
  h.importSelectedSheet();
  const version=h.ctx.state.planVersions[0];
  assert.equal(version.versionNo,2);
  assert.equal(version.differences.length,1);
  assert.equal(version.differences[0].kind,'new');
});

test('same-sheet reimport keeps IDs, working technology, exclusions and manual interpretation without duplicates',()=>{
  const h=setup(); const originalPending=h.ctx.pending; h.importSelectedSheet();
  h.ctx.state.plan[0].included=false;
  h.ctx.state.plan[0].technologyId='tech-1';
  h.ctx.state.plan[0].workingMaterials=[{id:'mat-1',usage:0.2}];
  const id=h.ctx.state.plan[0].id;
  setQuantity(h,h.ctx.state.plan[1],500);
  h.ctx.pending=originalPending; h.importSelectedSheet();
  assert.equal(h.ctx.state.plan.length,3);
  assert.equal(h.ctx.state.plan[0].id,id);
  assert.equal(h.ctx.state.plan[0].included,false);
  assert.equal(h.ctx.state.plan[0].technologyId,'tech-1');
  assert.equal(h.ctx.state.plan[0].workingMaterials[0].usage,0.2);
  assert.equal(h.ctx.state.plan[1].totalQty,500);
  assert.equal(h.ctx.state.plan[1].sourceQuantity,'');
  assert.equal(h.ctx.state.plan[1].quantityStatus,'manual');
  assert.equal(h.ctx.state.archive.length,0);
});

test('actual quantity correction can confirm explicit zero and undo it back to an unresolved amount',()=>{
  const h=setup(); h.importSelectedSheet();
  const item=h.ctx.state.plan[1];
  setQuantity(h,item,0);
  assert.equal(h.ctx.state.plan[1].quantityStatus,'manual');
  assert.equal(h.ctx.state.plan[1].sourceQuantity,'');
  assert.equal(h.ctx.state.plan[1].totalQty,0);
  h.undoLastCorrection(h.ctx.state.plan[1]);
  assert.equal(h.ctx.state.plan[1].quantityStatus,'missing');
});

test('actual reload cleaner preserves quantities, raw fields and warning state',()=>{
  const h=setup(); h.importSelectedSheet();
  const reloaded=h.parseStoredState(JSON.parse(JSON.stringify(h.ctx.state)));
  assert.equal(reloaded.plan.length,3);
  assert.equal(reloaded.plan[0].sourceQuantity,rows[1][2]);
  assert.equal(reloaded.plan[0].quantityParts.length,2);
  assert.equal(reloaded.plan[2].sourceQuantity,'DO RANA');
  assert.equal(reloaded.plan[2].quantityStatus,'unrecognized');
});

test('actual calculation never counts unknown quantity or restores a finished zero balance',()=>{
  const h=setup(); h.importSelectedSheet();
  assert.equal(h.itemProductionQty(h.ctx.state.plan[0]),7369);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[1]),0);
  assert.equal(h.itemProductionQty({...h.ctx.state.plan[0],remainingQty:0}),0);
});

test('actual document actions reject unresolved included rows, but allow deliberate exclusion',()=>{
  const h=setup(); h.importSelectedSheet();
  h.createOrRefreshPickingDocument();
  assert.match(h.messages.at(-1),/Nie można utworzyć kompletnego/);
  h.ctx.state.documents=[{id:'doc-1',areaId:'hala-2',status:'draft',rows:[]}];
  h.changePickingDocumentStatus('doc-1','handed');
  assert.equal(h.ctx.state.documents[0].status,'draft');
  h.ctx.state.plan.forEach(item=>{if(imports.quantityNeedsReview(item))item.included=false;});
  h.changePickingDocumentStatus('doc-1','handed');
  assert.equal(h.ctx.state.documents[0].status,'handed');
});

test('unknown active production must not produce a false return of issued material',()=>{
  const h=setup(); h.importSelectedSheet();
  const item=h.ctx.state.plan[1]; item.areaId='hala-2';
  h.ctx.state.documents=[{planDate:'2026-08-31',areaId:'hala-2',status:'issued',rows:[{key:'MAT',code:'MAT',name:'Material',category:'Tworzywo',unit:'kg',toIssue:100,sources:[{planItemId:item.id,index:item.index,name:item.name,demand:100}]}]}];
  assert.equal(h.deriveReturnsForDate('2026-08-31').length,0);
  item.included=false;
  assert.equal(h.deriveReturnsForDate('2026-08-31')[0].surplus,100);
});

test('direct quantity editing groups typed digits and preserves the source and issued documents', {skip: !directQuantityEditing},()=>{
  const h=setup(); h.importSelectedSheet();
  const id=h.ctx.state.plan[0].id;
  h.updatePlanQuantity(id,90,'set-90');
  h.ctx.state.documents=[
    {id:'draft',planDate:h.ctx.state.selectedPlanDate,status:'draft'},
    {id:'issued',planDate:h.ctx.state.selectedPlanDate,status:'issued'}
  ];
  for(const quantity of [1,12,120])h.updatePlanQuantity(id,quantity,'set-120');
  const edited=h.ctx.state.plan[0];
  assert.equal(edited.remainingQty,120);
  assert.equal(edited.sourceQuantity,rows[1][2]);
  assert.equal(h.itemProductionQty(edited),120);
  assert.equal(h.ctx.state.quantityCorrections.length,2);
  assert.equal(h.ctx.state.quantityCorrections[0].previousValue,90);
  assert.equal(h.ctx.state.quantityCorrections[0].newValue,120);
  assert.equal(h.ctx.state.documents[0].status,'outdated');
  assert.equal(h.ctx.state.documents[1].status,'issued');
  h.undoLastCorrection(edited);
  assert.equal(h.ctx.state.plan[0].remainingQty,90);
  assert.equal(h.ctx.state.plan[0].quantityStatus,'manual');
});

test('direct norm editing affects only the production and respects an explicit zero', {skip: !directQuantityEditing},()=>{
  const h=setup(); h.importSelectedSheet();
  const id=h.ctx.state.plan[0].id;
  h.ctx.state.technologies=[{id:'tech',shiftNorm:1400}];
  h.ctx.state.plan[0].technologyId='tech';
  h.ctx.state.calculationMode='horizon';
  h.updatePlanNorm(id,500);
  assert.equal(h.ctx.state.plan[0].shiftNorm,500);
  assert.equal(h.ctx.state.technologies[0].shiftNorm,1400);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[0]),1750);
  h.updatePlanNorm(id,0);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[0]),0);
  h.updatePlanNorm(id,-100);
  assert.equal(h.ctx.state.plan[0].shiftNorm,0);
});
