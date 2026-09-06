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
const names = ['uid','numberValue','normalize','MATERIAL_WAREHOUSE_PRIORITY','MATERIAL_WAREHOUSE_RANK','PACKAGING_CATEGORIES','splitProductFields','stationKey','applyStationMappings','materialKey','materialIdentityMatches','isPackagingMaterial','technologyMaterialsForMode','migrateLegacyEmergencyTechnologies','normalizedMaterialUnit','isKilogramUnit','isGramUnit','isThousandPiecesUnit','technologyResultUnit','technologyResultQuantity','roundTechnologyMaterialQuantity','canonicalProductIndex','linkedProductKey','linkedProductMatchesPlanItem','linkedSourceSelectionForItem','linkedMachineProductQuantity','linkedWarehouseProductQuantity','linkedSurplusQuantity','normalizeLinkedSources','technologyUsageInputUnit','technologyUsageForEditor','technologyUsageFromEditor','technologyMaterialWithUnit','clonePlanItems','cloneMaterials','applyDefaultTechnologyAssignments','preparePlanningAutosaveState','documentStatusLabel','pickingRowWasWritten','cleanImportedTechnologyDescription','technologyMatchesProduct','updateBaseTechnologyFromWorkingCopy','findExactCatalogItem','parseStoredState','parsePlanRows','planItemSignature',
  'handleWorkbook','importSelectedSheet','selectPlanningArea',directQuantityEditing ? 'updatePlanQuantity' : 'applyQuantityCorrection','undoLastCorrection','scopeForItem','shiftNormForItem','plannedItemProductionQty','itemProductionQty','planQuantityNeedsReview','createOrRefreshPickingDocument','changePickingDocumentStatus','togglePickingConfirmation','deriveReturnsForDate','syncOriginalInventory'];
if (directQuantityEditing) names.push('updatePlanNorm');
const definitions = new Map();
const areaCalculationNames = ['technologyForItem','materialsForItem','technologyLinksForItem','linkedProducerCandidates','linkedProducerFor','linkedAllocationByProducer','selectedLinkedAllocationByProducer','fullLinkedAllocationByProducer','materialDemandContributionsForItem','demandByArea','sharedAreaIds','materialSupply','requirementsForArea'];
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
    state:{plan:[],technologies:[],archive:[],planVersions:[],documents:[],quantityCorrections:[],stationMappings:[],selectedPlanDate:'2026-08-31',selectedAreaId:'hala-2',dailyPlans:{},returnStatuses:{},inventory:[],areas:[],calculationMode:'all',horizonShifts:3.5},
    pending:{fileName:'test.xlsx',purpose:'plan',workbook:{SheetNames:['Plan'],Sheets:{Plan:{rows}}}},sheetName:'Plan',currentUserName:'Test',quantityInputs:{},readOnly:false,
    calculationEditorOpen:false,closeCalculationEditorIfAllowed:()=>true,inventorySyncRequestRef:{current:0},
    XLSX:{read:(data)=>data,utils:{sheet_to_json:(sheet)=>sheet.rows,decode_range:()=>({s:{r:0}})}},
    flash:(message)=>messages.push(message),nowLabel:()=>new Date().toISOString(),localDateKey:()=>'2026-08-31',formatPlanDate:(date)=>date,
    mergeAreas:(areas)=>areas,emptyState:()=>({plan:[],technologies:[]}),cloneMaterials:(items)=>JSON.parse(JSON.stringify(items)),technologyForItem:()=>undefined,
    materialsForItem:()=>[{code:'MAT',unit:'kg',usage:1}],materialKey:()=> 'MAT',requirementsForArea:()=>[],
    selectedLinkedAllocationByProducer:new Map(),fullLinkedAllocationByProducer:new Map(),linkedSourceIssuesForArea:()=>[]
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
  ctx.technologyForItem=(item)=>ctx.state.technologies.find((technology)=>technology.id===item.technologyId);
  vm.runInContext(compiled,ctx);
  return {ctx,messages,...ctx.exports};
}

const setQuantity = (h,item,value) => {
  if(directQuantityEditing) h.updatePlanQuantity(item.id,value,'edit-'+item.id);
  else { h.ctx.quantityInputs[item.id]=String(value); h.applyQuantityCorrection(item,'exact'); }
};

test('technology mass factors are edited in grams without changing stored kilograms',()=>{
  const h=setup();
  const material={id:'mat',code:'MAT',name:'Material',category:'Tworzywo',usage:0.075,unit:'kg',logisticQty:1000};
  assert.equal(h.technologyUsageInputUnit(material),'g');
  assert.equal(h.technologyUsageForEditor(material),75);
  assert.ok(Math.abs(h.technologyUsageFromEditor(material,138.2)-0.1382)<1e-12);

  const storedInGrams={...material,usage:7.11,unit:'g'};
  const converted=h.technologyMaterialWithUnit(storedInGrams,'kg');
  assert.ok(Math.abs(converted.usage-0.00711)<1e-12);
  assert.equal(h.technologyUsageForEditor(converted),7.11);

  const counted={...material,usage:2,unit:'szt.'};
  assert.equal(h.technologyUsageInputUnit(counted),'szt.');
  assert.equal(h.technologyUsageForEditor(counted),2);
  assert.equal(h.technologyUsageFromEditor(counted,3),3);

  const labels={...material,usage:0.0000083,unit:'1000szt.'};
  assert.equal(h.technologyUsageInputUnit(labels),'szt.');
  assert.ok(Math.abs(h.technologyUsageForEditor(labels)-0.0083)<1e-12);
  assert.ok(Math.abs(h.technologyUsageFromEditor(labels,0.0083)-0.0000083)<1e-12);
  assert.equal(h.technologyResultUnit(labels.unit),'szt.');
  assert.ok(Math.abs(h.technologyResultQuantity(0.007968,labels.unit)-7.968)<1e-12);
  assert.equal(h.technologyResultQuantity(7.968,counted.unit),7.968);
});

test('discrete technology materials round up while mass remains exact',()=>{
  const h=setup();
  assert.equal(h.roundTechnologyMaterialQuantity(673.4,'kg'),673.4);
  assert.equal(h.roundTechnologyMaterialQuantity(77.77,'szt.'),78);
  assert.equal(h.roundTechnologyMaterialQuantity(21.6,'opak'),22);
  assert.equal(h.roundTechnologyMaterialQuantity(3.64,'szt.'),4);
  assert.equal(h.roundTechnologyMaterialQuantity(7.000000000000001,'opak'),7);
  assert.equal(h.roundTechnologyMaterialQuantity(0.0492,'1000szt.'),0.05);
  assert.equal(h.technologyResultQuantity(h.roundTechnologyMaterialQuantity(0.0492,'1000szt.'),'1000szt.'),50);
});

test('requirements round every discrete product source before aggregation',()=>{
  const h=setup();
  h.importSelectedSheet();
  const base={
    ...h.ctx.state.plan[0],quantityStatus:'parsed',technologyId:'carton-tech',workingMaterials:null,
    totalQty:10,remainingQty:10,scopeMode:'all',included:true,areaId:'hala-2'
  };
  h.ctx.state.plan=[{...base,id:'product-a'},{...base,id:'product-b'}];
  h.ctx.state.areas=[{id:'hala-2',name:'Hala 2'}];
  h.ctx.state.inventory=[];
  h.ctx.state.technologies=[{
    id:'carton-tech',materials:[{id:'carton',code:'KAR',name:'Karton',category:'Karton',unit:'szt.',usage:0.125,logisticQty:1}]
  }];
  h.ctx.needsMaterialBalances=true;
  h.ctx.documentLedger=new Map();
  h.ctx.CATEGORY_ORDER=new Map();
  const code=ts.transpileModule('(()=>{'+[...areaCalculationDefinitions.values()].join('\n')+';return requirementsForArea;})()',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const requirementsForArea=vm.runInContext(code,h.ctx);
  const [requirement]=requirementsForArea('hala-2');
  assert.deepEqual(Array.from(requirement.sources,(source)=>source.demand),[2,2]);
  assert.equal(requirement.demand,4);
  assert.equal(requirement.toIssue,4);
});

test('linked tray production uses full resin output and packages only the warehouse surplus',()=>{
  const h=setup(); h.importSelectedSheet();
  h.ctx.state.calculationMode='horizon';
  h.ctx.state.horizonShifts=1;
  const panel={
    ...h.ctx.state.plan[0],id:'panel',index:'8001128772',name:'MAX BO VG1 CP BODY',quantityStatus:'parsed',
    technologyId:'panel-tech',totalQty:1400,remainingQty:1400,shiftNorm:700,scopeMode:'global',included:true,areaId:'hala-2',
    linkedSources:{'8001128941':{mode:'production',producerPlanItemId:'tray',productionQuantity:0}}
  };
  const tray={
    ...panel,id:'tray',index:'M-10-8001128941',name:'TRAY HANDLE BO CLIPPED VG1 VZF07020',quantityStatus:'missing',sourceQuantity:'',
    technologyId:'tray-tech',totalQty:0,remainingQty:0,shiftNorm:0,linkedSources:{}
  };
  const material=(id,code,name,category,usage,unit='szt.')=>({id,code,name,category,usage,unit,logisticQty:1});
  h.ctx.state.plan=[panel,tray];
  h.ctx.state.areas=[{id:'hala-2',name:'Hala 2'}];
  h.ctx.state.inventory=[];
  h.ctx.state.technologies=[
    {id:'panel-tech',productIndex:'8001128772',productName:panel.name,materials:[material('insert','M-10-8001103471','INSERT','Półwyrób',1)],linkedProducts:[{id:'tray-link',productIndex:'M-10-8001128941',productName:tray.name,usage:1,unit:'szt.'}]},
    {id:'tray-tech',productIndex:'M-10-8001128941',productName:tray.name,productionMode:'continuous',shiftNorm:1600,materials:[material('resin','ABS-ELIX','ABS ELIX','Tworzywo',0.1092,'kg')],surplusMaterials:[material('carton','CARTON','Karton','Karton',0.0333),material('separator','SEP','Przekładka','Przekładka',10/60)]}
  ];
  assert.equal(h.planQuantityNeedsReview(tray),false,'missing final quantity is valid for continuous production');
  assert.equal(h.itemProductionQty(tray),1600,'continuous output follows rate multiplied by selected shifts');
  h.ctx.needsMaterialBalances=true;
  h.ctx.documentLedger=new Map();
  h.ctx.CATEGORY_ORDER=new Map();
  const code=ts.transpileModule('(()=>{'+[...areaCalculationDefinitions.values()].join('\n')+';return requirementsForArea;})()',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const requirementsForArea=vm.runInContext(code,h.ctx);
  const requirements=new Map(requirementsForArea('hala-2').map((row)=>[row.code,row]));
  assert.equal(requirements.get('M-10-8001103471').demand,700,'insert follows panel quantity only');
  assert.equal(requirements.get('M-10-8001103471').fullDemand,1400,'the finite panel still keeps its complete-plan demand');
  assert.ok(Math.abs(requirements.get('ABS-ELIX').demand-174.72)<1e-12,'resin follows all 1600 trays');
  assert.equal(requirements.get('CARTON').demand,30,'cartons follow the 900-piece surplus');
  assert.equal(requirements.get('CARTON').fullDemand,30,'continuous surplus has no artificial complete-plan quantity');
  assert.equal(requirements.get('SEP').demand,150,'separators follow the 900-piece surplus');
  assert.equal(requirements.has('M-10-8001128941'),false,'machine-fed tray is not issued from warehouse');
});

test('linked handle follows basket demand and uses packaging only for a future semifinished surplus',()=>{
  const h=setup(); h.importSelectedSheet();
  h.ctx.state.calculationMode='all';
  const basket={
    ...h.ctx.state.plan[0],id:'basket',index:'A23587002',name:'IRIS CUTLERY BASKET SPLITABLE ASM',quantityStatus:'parsed',
    technologyId:'basket-tech',totalQty:100,remainingQty:100,shiftNorm:0,scopeMode:'all',included:true,areaId:'hala-2',
    linkedSources:{
      a23586802:{mode:'production',producerPlanItemId:'handle',productionQuantity:0},
      a23586602:{mode:'warehouse',producerPlanItemId:'',productionQuantity:0}
    }
  };
  const handle={
    ...basket,id:'handle',index:'A23586802',name:'IRIS CB SPLITABLE HANDLE',quantityStatus:'missing',sourceQuantity:'',
    technologyId:'handle-tech',totalQty:0,remainingQty:0,linkedSources:{}
  };
  const material=(id,code,name,category,usage,unit='szt.')=>({id,code,name,category,usage,unit,logisticQty:1});
  h.ctx.state.plan=[basket,handle];
  h.ctx.state.areas=[{id:'hala-2',name:'Hala 2'}];
  h.ctx.state.inventory=[];
  h.ctx.state.technologies=[
    {
      id:'basket-tech',productIndex:'A23587002',productName:basket.name,
      materials:[material('basket-resin','PP-GREY','PP COMPOUND GREY','Tworzywo',0.412,'kg')],
      linkedProducts:[
        {id:'handle-link',productIndex:'A23586802',productName:handle.name,usage:2,unit:'szt.'},
        {id:'lid-link',productIndex:'A23586602',productName:'IRIS CB SPLITABLE LID',usage:2,unit:'szt.'}
      ]
    },
    {
      id:'handle-tech',productIndex:'A23586802',productName:handle.name,productionMode:'linked',
      materials:[material('handle-resin','PP-GREY','PP COMPOUND GREY','Tworzywo',0.03865,'kg')],
      surplusMaterials:[
        material('handle-carton','HANDLE-CARTON','Karton półwyrobu','Karton',0.003),
        material('handle-separator','HANDLE-SEP','Przekładka półwyrobu','Przekładka',0.1429)
      ]
    }
  ];
  h.ctx.selectedLinkedAllocationByProducer=new Map([['handle',200]]);
  h.ctx.fullLinkedAllocationByProducer=new Map([['handle',200]]);
  assert.equal(h.itemProductionQty(handle),200,'missing own quantity is filled by basket demand');
  assert.equal(h.planQuantityNeedsReview(handle),false,'linked demand resolves the missing plan quantity');

  h.ctx.needsMaterialBalances=true;
  h.ctx.documentLedger=new Map();
  h.ctx.CATEGORY_ORDER=new Map();
  const code=ts.transpileModule('(()=>{'+[...areaCalculationDefinitions.values()].join('\n')+';return requirementsForArea;})()',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const requirementsForArea=vm.runInContext(code,h.ctx);
  let requirements=new Map(requirementsForArea('hala-2').map((row)=>[row.code,row]));
  assert.ok(Math.abs(requirements.get('PP-GREY').demand-48.93)<1e-12,'resin includes the basket and exactly two handles per basket');
  assert.equal(requirements.has('HANDLE-CARTON'),false,'direct-fed handles need no semifinished carton');
  assert.equal(requirements.has('HANDLE-SEP'),false,'direct-fed handles need no semifinished separators');
  assert.equal(requirements.has('A23586802'),false,'direct-fed handles are not issued from warehouse');
  assert.equal(requirements.get('A23586602').demand,200,'lids still come from the warehouse');

  Object.assign(handle,{quantityStatus:'parsed',sourceQuantity:'250',totalQty:250,remainingQty:250});
  requirements=new Map(requirementsForArea('hala-2').map((row)=>[row.code,row]));
  assert.ok(Math.abs(requirements.get('PP-GREY').demand-50.8625)<1e-12,'resin also covers the 50-piece own-plan surplus');
  assert.equal(requirements.get('HANDLE-CARTON').demand,1,'only the surplus is packed into cartons');
  assert.equal(requirements.get('HANDLE-SEP').demand,8,'only the surplus receives separators');
});

test('legacy emergency packaging becomes a complete, described technology variant',()=>{
  const h=setup();
  const row=(id,name,category)=>({id,code:id,name,category,usage:1,unit:'szt.',logisticQty:1});
  const technology={
    id:'door',productIndex:'8001188309',productName:'DOOR END',variant:'base',alternativeNo:0,
    description:'',notes:'',shiftNorm:0,archived:false,
    materials:[
      row('abs','ABS','Tworzywo'),
      row('container','Pojemnik KTP','Opakowanie'),
      row('label','Etykieta','Opakowanie'),
      row('separator','Przekładka bazowa','Przekładka')
    ],
    emergencyMaterials:[
      row('carton','Karton awaryjny','Karton'),
      row('emergency-separator','Przekładka awaryjna','Przekładka')
    ]
  };

  const migration=h.migrateLegacyEmergencyTechnologies([technology]);
  assert.equal(migration.technologies.length,2);
  const base=migration.technologies.find((item)=>item.variant==='base');
  const emergency=migration.technologies.find((item)=>item.variant==='alternative');
  assert.deepEqual(Array.from(base.emergencyMaterials),[]);
  assert.equal(emergency.alternativeNo,1);
  assert.match(emergency.description,/Karton awaryjny/);
  assert.deepEqual(Array.from(emergency.materials,(material)=>material.name),[
    'ABS','Karton awaryjny','Przekładka awaryjna'
  ]);
  assert.equal(migration.alternativeByBaseId.door,emergency.id);
  assert.equal(technology.materials.length,4,'migration must not mutate the saved base set');
});

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
  const state={...h.ctx.state,plan:[legacy],dailyPlans:{'2026-08-31':[legacy],'2026-08-30':[legacy]},planVersions:[{...h.ctx.state.planVersions[0],items:[legacy]}],archive:[{id:'archive-kept',status:'suspended',planItem:legacy}],technologies:[{id:'tech-kept',productName:product.raw,productIndex:product.raw,description:'Import: WĘGRY',shiftNorm:123,materials:legacy.workingMaterials}]};
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
  assert.equal(reloaded.technologies[0].description,'');
  assert.equal(state.plan[0].name,product.raw,'do not mutate the original state');
});

test('saving a working copy updates the existing base without creating an alternative',()=>{
  const h=setup();
  const technologies=[
    {id:'base',productIndex:'A100',productName:'PART',variant:'base',alternativeNo:0,shiftNorm:100,materials:[{id:'old'}],archived:false},
    {id:'selected',productIndex:'A100',productName:'PART',variant:'alternative',alternativeNo:1,shiftNorm:120,materials:[{id:'selected'}],archived:false},
    {id:'other',productIndex:'B200',productName:'OTHER',variant:'base',alternativeNo:0,shiftNorm:90,materials:[],archived:false}
  ];
  const materials=[{id:'new-material',usage:0.25}];
  const result=h.updateBaseTechnologyFromWorkingCopy(technologies,'selected',materials,250);
  assert.equal(result.baseId,'base');
  assert.equal(result.technologies.length,technologies.length);
  assert.equal(result.technologies.find((technology)=>technology.id==='base').variant,'base');
  assert.equal(result.technologies.find((technology)=>technology.id==='base').shiftNorm,250);
  assert.equal(result.technologies.find((technology)=>technology.id==='base').materials[0].usage,0.25);
  assert.equal(result.technologies.find((technology)=>technology.id==='selected').variant,'alternative');
  assert.equal(technologies[0].shiftNorm,100,'do not mutate the original library');
});

test('an exact material name resolves its index using warehouse priority',()=>{
  const h=setup();
  const items=[
    {id:'m51',name:'POKRYWA WYMIENNIKÓW CIEPŁA T27SCO',index:'M-51-OLD',warehouseCode:'M-51'},
    {id:'m4',name:'POKRYWA WYMIENNIKÓW CIEPŁA T27SCO',index:'M-4-INDEX',warehouseCode:'M-4'},
    {id:'m1',name:'POKRYWA WYMIENNIKÓW CIEPŁA T27SCO',index:'M-1-INDEX',warehouseCode:'M-1'}
  ];
  assert.equal(h.findExactCatalogItem(items,'name','pokrywa wymienników ciepła t27sco').index,'M-1-INDEX');
  assert.equal(h.findExactCatalogItem(items,'name','pokrywa wymienników'),undefined);
});

test('actual import handler retains every row, source text and version snapshot',()=>{
  const h=setup(); h.importSelectedSheet();
  const [left,right,housing,unknown]=h.ctx.state.plan;
  assert.equal(h.ctx.state.plan.length,4);
  assert.equal(h.ctx.state.planVersions[0].items.length,4);
  assert.deepEqual(Array.from(h.ctx.state.plan,(item)=>item.index),['A100','A200','B100','C100']);
  assert.deepEqual(Array.from(h.ctx.state.plan,(item)=>item.totalQty),[3594,3775,0,0]);
  assert.ok(left.productionGroupId);
  assert.equal(left.productionGroupId,right.productionGroupId);
  assert.deepEqual([left.productionOutputOrder,right.productionOutputOrder],[0,1]);
  assert.ok([left,right].every((item)=>item.productionSourceQuantity===rows[1][2]));
  assert.equal(housing.quantityStatus,'missing');
  assert.equal(unknown.quantityStatus,'unrecognized');
  assert.match(h.messages.at(-1),/3 produkcji, 4 detali/);
});

test('one mould run assigns each output its own base technology and aggregates shared material demand',()=>{
  const h=setup();
  const mouldRows=[rows[0],[
    '1',
    'PLV QUICK LIFT SLIDER LEFT + WHEEL DORIS 229, PLV QUICK LIFT SLIDER RIGHT + WHEEL DORIS 229 (A18208403, A18208404)',
    '10 950, 10 950',
    'WTR 18',
    1300
  ]];
  h.ctx.pending={...h.ctx.pending,workbook:{SheetNames:['Plan'],Sheets:{Plan:{rows:mouldRows}}}};
  const material=(id,usage)=>({id,code:'ABS-01',name:'ABS',category:'Tworzywo',usage,unit:'kg',logisticQty:1});
  h.ctx.state.technologies=[
    {id:'left-tech',productIndex:'A18208403',productName:'PLV QUICK LIFT SLIDER LEFT + WHEEL DORIS 229',variant:'base',shiftNorm:100,materials:[material('left-mat',0.1)],archived:false},
    {id:'right-tech',productIndex:'A18208404',productName:'PLV QUICK LIFT SLIDER RIGHT + WHEEL DORIS 229',variant:'base',shiftNorm:200,materials:[material('right-mat',0.2)],archived:false},
    {id:'combined-tech',productIndex:'A18208403, A18208404',productName:'PLV QUICK LIFT SLIDER LEFT + WHEEL DORIS 229, PLV QUICK LIFT SLIDER RIGHT + WHEEL DORIS 229',variant:'base',shiftNorm:999,materials:[],archived:false}
  ];
  h.importSelectedSheet();
  const [left,right]=h.ctx.state.plan;
  assert.deepEqual([left.index,right.index],['A18208403','A18208404']);
  assert.deepEqual([left.technologyId,right.technologyId],['left-tech','right-tech']);
  assert.deepEqual([left.shiftNorm,right.shiftNorm],[1300,1300]);
  assert.equal(left.productionGroupId,right.productionGroupId);
  assert.ok(!h.ctx.state.plan.some((item)=>item.technologyId==='combined-tech'));

  h.ctx.state.calculationMode='horizon';
  h.ctx.state.horizonShifts=1;
  left.areaId='hala-2';
  right.areaId='hala-2';
  h.ctx.state.areas=[{id:'hala-2',name:'Hala 2'}];
  h.ctx.state.inventory=[];
  h.ctx.needsMaterialBalances=true;
  h.ctx.documentLedger=new Map();
  h.ctx.CATEGORY_ORDER=new Map();
  const code=ts.transpileModule('(()=>{'+[...areaCalculationDefinitions.values()].join('\n')+';return requirementsForArea;})()',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const requirementsForArea=vm.runInContext(code,h.ctx);
  const [requirement]=requirementsForArea('hala-2');
  assert.equal(h.itemProductionQty(left),1300);
  assert.equal(h.itemProductionQty(right),1300);
  assert.ok(Math.abs(requirement.demand-390)<1e-9);
  assert.deepEqual(Array.from(requirement.sources,(source)=>source.planItemId),[left.id,right.id]);
});

test('reopening upgrades an unissued legacy composite row but preserves issued document references',()=>{
  const h=setup();
  const legacy={
    id:'legacy',runId:'legacy-run',index:'A100, A200',name:'LEFT + RIGHT',station:'WTR 34',areaId:'hala-2',
    included:true,technologyId:'combined-tech',workingMaterials:[],manualOverride:false,continuationCandidateId:'',
    totalQty:7369,remainingQty:3684.5,shiftNorm:1400,quantityStatus:'parsed',sourceQuantity:'L - 3 594 P - 3 775',
    quantityParts:[{label:'L',quantity:3594},{label:'P',quantity:3775}],planGroup:'standard',plannedDate:'',notes:''
  };
  const technology=(id,index,name,norm)=>({id,productIndex:index,productName:name,variant:'base',shiftNorm:norm,materials:[],archived:false});
  const technologies=[technology('left-tech','A100','LEFT',100),technology('right-tech','A200','RIGHT',200)];
  const rawState={...h.ctx.state,plan:[legacy],technologies,dailyPlans:{'2026-08-31':[legacy]},planVersions:[],documents:[]};
  const restored=h.preparePlanningAutosaveState(h.parseStoredState(JSON.parse(JSON.stringify(rawState))));
  assert.deepEqual(Array.from(restored.plan,(item)=>item.index),['A100','A200']);
  assert.deepEqual(Array.from(restored.plan,(item)=>item.technologyId),['left-tech','right-tech']);
  assert.deepEqual(Array.from(restored.plan,(item)=>item.remainingQty),[1797,1887.5]);
  assert.ok(restored.plan.every((item)=>item.shiftNorm===1400));
  assert.equal(restored.plan[0].productionGroupId,restored.plan[1].productionGroupId);
  assert.equal(restored.dailyPlans['2026-08-31'].length,2);
  assert.equal(restored.planVersions[0].items.length,2);

  const issuedState={...rawState,documents:[{status:'issued',rows:[{sources:[{planItemId:'legacy'}]}]}]};
  const protectedState=h.parseStoredState(JSON.parse(JSON.stringify(issuedState)));
  assert.equal(protectedState.plan.length,1);
  assert.equal(protectedState.plan[0].id,'legacy');

  const writtenDraftState={...rawState,documents:[{status:'draft',rows:[{confirmed:true,sources:[{planItemId:'legacy'}]}]}]};
  const protectedWrittenDraft=h.parseStoredState(JSON.parse(JSON.stringify(writtenDraftState)));
  assert.equal(protectedWrittenDraft.plan.length,1);
  assert.equal(protectedWrittenDraft.plan[0].id,'legacy');
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
  setQuantity(h,h.ctx.state.plan.find((item)=>item.index==='B100'),500);
  h.ctx.pending=originalPending; h.importSelectedSheet();
  assert.equal(h.ctx.state.plan.length,4);
  assert.equal(h.ctx.state.plan[0].id,id);
  assert.equal(h.ctx.state.plan[0].included,false);
  assert.equal(h.ctx.state.plan[0].technologyId,'tech-1');
  assert.equal(h.ctx.state.plan[0].workingMaterials[0].usage,0.2);
  const housing=h.ctx.state.plan.find((item)=>item.index==='B100');
  assert.equal(housing.totalQty,500);
  assert.equal(housing.sourceQuantity,'');
  assert.equal(housing.quantityStatus,'manual');
  assert.equal(h.ctx.state.plan[0].productionGroupId,h.ctx.state.plan[1].productionGroupId);
  assert.equal(h.ctx.state.archive.length,0);
});

test('actual quantity correction can confirm explicit zero and undo it back to an unresolved amount',()=>{
  const h=setup(); h.importSelectedSheet();
  const item=h.ctx.state.plan.find((entry)=>entry.index==='B100');
  setQuantity(h,item,0);
  const updated=h.ctx.state.plan.find((entry)=>entry.index==='B100');
  assert.equal(updated.quantityStatus,'manual');
  assert.equal(updated.sourceQuantity,'');
  assert.equal(updated.totalQty,0);
  h.undoLastCorrection(updated);
  assert.equal(h.ctx.state.plan.find((entry)=>entry.index==='B100').quantityStatus,'missing');
});

test('actual reload cleaner preserves quantities, raw fields and warning state',()=>{
  const h=setup(); h.importSelectedSheet();
  const reloaded=h.parseStoredState(JSON.parse(JSON.stringify(h.ctx.state)));
  assert.equal(reloaded.plan.length,4);
  assert.deepEqual(Array.from(reloaded.plan.slice(0,2),(item)=>item.sourceQuantity),['L - 3594','P - 3775']);
  assert.ok(reloaded.plan.slice(0,2).every((item)=>item.productionSourceQuantity===rows[1][2]));
  assert.ok(reloaded.plan.slice(0,2).every((item)=>item.quantityParts.length===0));
  assert.equal(reloaded.plan[3].sourceQuantity,'DO RANA');
  assert.equal(reloaded.plan[3].quantityStatus,'unrecognized');
});

test('actual calculation never counts unknown quantity or restores a finished zero balance',()=>{
  const h=setup(); h.importSelectedSheet();
  assert.equal(h.itemProductionQty(h.ctx.state.plan[0]),3594);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[1]),3775);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[2]),0);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[3]),0);
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

test('document checklist must be complete before handoff and issued document can return to editing',()=>{
  const h=setup();
  const rows=[
    {key:'MAT-1',name:'Material 1',confirmed:false,toIssue:10},
    {key:'MAT-2',name:'Material 2',confirmed:false,toIssue:20}
  ];
  h.ctx.state.documents=[{id:'doc-1',documentNo:'DOC-1',planDate:'2026-08-31',areaId:'hala-2',status:'draft',rows}];

  h.changePickingDocumentStatus('doc-1','handed');
  assert.equal(h.ctx.state.documents[0].status,'draft');
  assert.match(h.messages.at(-1),/zaznacz po lewej wszystkie pozycje/i);

  h.togglePickingConfirmation('doc-1','MAT-1');
  assert.deepEqual(Array.from(h.ctx.state.documents[0].rows,(row)=>row.confirmed),[true,false]);
  h.changePickingDocumentStatus('doc-1','handed');
  assert.equal(h.ctx.state.documents[0].status,'draft');

  h.togglePickingConfirmation('doc-1','MAT-2');
  h.changePickingDocumentStatus('doc-1','handed');
  assert.equal(h.ctx.state.documents[0].status,'handed');
  h.changePickingDocumentStatus('doc-1','issued');
  assert.equal(h.ctx.state.documents[0].status,'issued');

  h.changePickingDocumentStatus('doc-1','draft');
  assert.equal(h.ctx.state.documents[0].status,'draft');
  assert.match(h.messages.at(-1),/cofnięty do edycji/i);
  assert.deepEqual(Array.from(h.ctx.state.documents[0].rows,(row)=>row.confirmed),[true,true]);
  h.togglePickingConfirmation('doc-1','MAT-1');
  assert.deepEqual(Array.from(h.ctx.state.documents[0].rows,(row)=>row.confirmed),[false,true]);
});

test('reopening cannot change a read-only, cancelled or older document',()=>{
  const h=setup();
  const row={key:'MAT',name:'Material',confirmed:true,toIssue:10};
  const newer={id:'newer',planDate:'2026-08-31',areaId:'hala-2',status:'draft',rows:[row]};
  const older={id:'older',planDate:'2026-08-31',areaId:'hala-2',status:'issued',rows:[row]};
  h.ctx.state.documents=[newer,older];
  h.changePickingDocumentStatus('older','draft');
  assert.equal(h.ctx.state.documents[1].status,'issued');
  assert.match(h.messages.at(-1),/nowszy dokument/i);

  h.ctx.state.documents=[{...older,status:'cancelled'}];
  h.changePickingDocumentStatus('older','draft');
  assert.equal(h.ctx.state.documents[0].status,'cancelled');

  h.ctx.state.documents=[older];
  h.ctx.readOnly=true;
  h.changePickingDocumentStatus('older','draft');
  h.togglePickingConfirmation('older','MAT');
  assert.equal(h.ctx.state.documents[0].status,'issued');
  assert.equal(h.ctx.state.documents[0].rows[0].confirmed,true);
});

test('document table places the written checkmarks first and exposes progress plus edit rollback',()=>{
  const documentSource=source.slice(source.indexOf('const renderDocumentV2 ='),source.indexOf('const renderReturnsV2 ='));
  const tableSource=documentSource.slice(documentSource.indexOf('<table'),documentSource.indexOf('</table>'));
  assert.ok(tableSource.indexOf('>Wypisane<')>=0);
  assert.ok(tableSource.indexOf('>Wypisane<')<tableSource.indexOf('>Materiał<'));
  assert.ok(tableSource.indexOf('aria-pressed={row.confirmed}')<tableSource.indexOf("title={sourcesExpanded ?"));
  assert.ok(!tableSource.includes('>Potwierdzenie<'));
  assert.ok(!tableSource.includes('>Już wydano<'));
  assert.ok(!tableSource.includes('>Oczekuje<'));
  assert.match(tableSource,/colSpan=\{7\}/);
  assert.ok(!documentSource.includes('Do wydania teraz'));
  assert.ok(!documentSource.includes('Dokumenty dla strefy'));
  assert.ok(!documentSource.includes('Aktualna wersja planu'));
  assert.match(documentSource,/Wszystko wypisane/);
  assert.match(documentSource,/Cofnij do edycji/);
  assert.match(documentSource,/changePickingDocumentStatus\(document\.id, 'draft'\)/);
});

test('an inventoried material absent from every current technology is returned in full',()=>{
  const h=setup(); h.importSelectedSheet();
  h.ctx.materialsForItem=()=>[{id:'used',code:'USED',name:'Potrzebny materiał',category:'Tworzywo',unit:'kg',usage:0.1,logisticQty:1}];
  h.ctx.state.areas=[{id:'hala-2',name:'Hala 2'},{id:'silosy',name:'Silosy',shared:true}];
  h.ctx.state.inventory=[
    {id:'unused',areaId:'hala-2',code:'UNUSED',name:'Materiał niepotrzebny',category:'Tworzywo',qty:75,unit:'kg'},
    {id:'used',areaId:'hala-2',code:'USED',name:'Potrzebny materiał',category:'Tworzywo',qty:300,unit:'kg'},
    {id:'shared',areaId:'silosy',code:'OTHER',name:'Stan wspólny',category:'Tworzywo',qty:900,unit:'kg'}
  ];

  const returns=h.deriveReturnsForDate('2026-08-31');
  assert.equal(returns.length,1);
  const [returned]=returns;
  assert.equal(returned.code,'UNUSED');
  assert.equal(returned.surplus,75);
  assert.equal(returned.inventoried,75);
  assert.equal(returned.reason,'Brak w technologiach aktualnego planu');
});

test('an inventoried material still present in technology never becomes a quantity surplus',()=>{
  const h=setup(); h.importSelectedSheet();
  h.ctx.materialsForItem=()=>[{id:'needed',code:'TECH-CODE',name:'Ten sam materiał',category:'Tworzywo',unit:'g',usage:0.001,logisticQty:1}];
  h.ctx.state.inventory=[{id:'stock',areaId:'hala-2',code:'SPIS-CODE',name:'Ten sam materiał',category:'Tworzywo',qty:1000,unit:'kg'}];
  assert.equal(h.deriveReturnsForDate('2026-08-31').length,0);

  h.ctx.materialsForItem=()=>[];
  assert.equal(h.deriveReturnsForDate('2026-08-31').length,0,'incomplete technologies must not mark the whole inventory for return');
});

test('inventory synchronization follows the selected plan date and ignores an older late response',async()=>{
  const h=setup();
  const pending=new Map();
  h.ctx.fetch=(url)=>new Promise((resolve)=>pending.set(new URL(String(url),'http://localhost').searchParams.get('date'),resolve));

  const friday=h.syncOriginalInventory(false,'2026-09-04');
  const saturday=h.syncOriginalInventory(false,'2026-09-05');
  pending.get('2026-09-05')({ok:true,json:async()=>({dateKey:'2026-09-05',syncedAt:'2026-09-05T12:00:00.000Z',rows:[{id:'sat',areaId:'hala-2',code:'SAT',name:'Stan sobotni',qty:5,unit:'kg'}]})});
  await saturday;
  pending.get('2026-09-04')({ok:true,json:async()=>({dateKey:'2026-09-04',syncedAt:'2026-09-04T12:00:00.000Z',rows:[{id:'fri',areaId:'hala-2',code:'FRI',name:'Stan piątkowy',qty:4,unit:'kg'}]})});
  await friday;

  assert.equal(h.ctx.state.inventorySourceDate,'2026-09-05');
  assert.equal(h.ctx.state.inventory[0].code,'SAT');
  const syncEffectStart=source.indexOf('void syncOriginalInventory(false, state.selectedPlanDate)');
  assert.ok(syncEffectStart>=0);
  assert.match(source.slice(syncEffectStart,syncEffectStart+300),/\[hydrated, state\.selectedPlanDate, view\]/);
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
  assert.equal(edited.sourceQuantity,'L - 3594');
  assert.equal(edited.productionSourceQuantity,rows[1][2]);
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
  assert.equal(h.ctx.state.plan[1].shiftNorm,500);
  assert.equal(h.ctx.state.technologies[0].shiftNorm,1400);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[0]),1750);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[1]),1750);
  h.updatePlanNorm(id,0);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[0]),0);
  assert.equal(h.itemProductionQty(h.ctx.state.plan[1]),0);
  h.updatePlanNorm(id,-100);
  assert.equal(h.ctx.state.plan[0].shiftNorm,0);
});
