import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { regrindDonutLayout } from './regrindDonutLayout.ts';

const sample = [650,350,350,200,122,120,10].map((value,index)=>({label:`Przemiał ${index} z pełną nazwą`,value,color:'#ff7700'}));
const verify = (items, width) => {
  const heights=items.map((_,i)=>48+(i%4)*20);
  const nameHeights=heights.map(height=>height-30);
  const layout=regrindDonutLayout(items,width,{heights,nameHeights});
  assert.equal(layout.callouts.length,items.length);
  assert.equal(layout.cx,layout.width/2);
  for(const label of layout.callouts){
    assert.ok(label.x>=0 && label.x+label.width<=layout.width);
    assert.ok(label.y>=0 && label.y+label.height<=layout.height);
    assert.ok(Math.abs(Math.hypot(label.start.x-layout.cx,label.start.y-layout.cy)-layout.radius)<0.00001);
    assert.ok(label.end.x>=0 && label.end.x<=layout.width);
    assert.ok(label.end.y>=label.y && label.end.y<=label.y+label.height);
    assert.doesNotMatch(label.path,/NaN|Infinity/);
    for(const other of layout.callouts){
      if(other.index<=label.index)continue;
      assert.equal(label.x<other.x+other.width && label.x+label.width>other.x && label.y<other.y+other.height && label.y+label.height>other.y,false);
    }
  }
  assert.deepEqual(layout.callouts.map(({label,value,color})=>({label,value,color})),items);
  return layout;
};

test('large centered ring has a permanent callout for every material without overlapping labels',()=>{
  const before=JSON.stringify(sample);
  for(const width of [220,247,320,375,600,899,900,1000,1100,1200])verify(sample,width);
  assert.equal(JSON.stringify(sample),before);
  assert.equal(verify(sample,1200).radius,210);
});

test('desktop leader paths do not cross or pass through the ring',()=>{
  const crossing=(a,b,c,d)=>{
    const turn=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    return turn(a,b,c)*turn(a,b,d)<0 && turn(c,d,a)*turn(c,d,b)<0;
  };
  const many=Array.from({length:35},(_,i)=>({label:`Material ${i}`,value:i?i:10000,color:'#22c55e'}));
  for(const width of [900,1000,1200]){
    for(const items of [sample,many]){
      const layout=verify(items,width);
      for(const label of layout.callouts){
        assert.ok(label.leaderPoints.every(p=>Math.hypot(p.x-layout.cx,p.y-layout.cy)>=layout.radius-0.1));
      }
      for(let i=0;i<layout.callouts.length;i++){
        const a=layout.callouts[i].leaderPoints;
        for(let j=i+1;j<layout.callouts.length;j++){
          const b=layout.callouts[j].leaderPoints;
          for(let x=1;x<a.length;x++)for(let y=1;y<b.length;y++)assert.equal(crossing(a[x-1],a[x],b[y-1],b[y]),false);
        }
      }
    }
  }
});

test('ordinary reports use continuous radial curves instead of long horizontal wire segments',()=>{
  for(const values of [[650,350,350,200,122,120,10],[720,200,100,100,50]]){
    const items=values.map((value,index)=>({label:`Material ${index}`,value,color:'#22c55e'}));
    const layout=regrindDonutLayout(items,1143,{heights:items.map(()=>70),nameHeights:items.map(()=>40)});
    for(const label of layout.callouts){
      assert.match(label.path,/ C /);
      assert.doesNotMatch(label.path,/ H | L /);
      const first=label.leaderPoints[1];
      assert.ok((first.x-label.start.x)*(label.start.x-layout.cx)+(first.y-label.start.y)*(label.start.y-layout.cy)>0);
    }
  }
});

test('narrow-screen leader bends are rounded and still end beside the material name',()=>{
  const layout=verify(sample,375);
  for(const label of layout.callouts){
    assert.equal((label.path.match(/ Q /g)??[]).length,2);
    assert.ok(label.end.y>=label.y && label.end.y<label.y+label.height);
  }
});

test('many small slices and tall measured names remain separate rather than becoming Other',()=>{
  const many=Array.from({length:35},(_,i)=>({label:`PEŁNA NAZWA ${i}`,value:i===0?10000:i+0.001,color:'#22c55e'}));
  for(const width of [247,375,900,1200])verify(many,width);
});

test('callout origins follow actual Recharts angles, including rounded gaps',()=>{
  const angles=[75,-10,-90,-160,-200,-240,-265];
  const layout=regrindDonutLayout(sample,1200,{angles});
  layout.callouts.forEach((item,index)=>{
    assert.ok(Math.abs(item.start.x-layout.cx-Math.cos(angles[index]*Math.PI/180)*layout.radius)<0.00001);
    assert.ok(Math.abs(item.start.y-layout.cy+Math.sin(angles[index]*Math.PI/180)*layout.radius)<0.00001);
  });
  assert.equal(regrindDonutLayout([],NaN).width,1200);
  assert.equal(regrindDonutLayout([{label:'invalid',value:NaN,color:''}],1200).callouts.length,0);
});

const pageSource=()=>readFileSync(new URL('../../app/(main)/raporty/page.tsx',import.meta.url),'utf8');
const typescript=()=>createRequire(import.meta.url)('typescript');

test('daily, period and yearly reports all stack Wyrobiono above Przybyło',()=>{
  const ts=typescript();
  const ast=ts.createSourceFile('page.tsx',pageSource(),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const pairs=[];
  const visit=node=>{
    if(ts.isJsxElement(node)){
      const panels=node.children.filter(child=>ts.isJsxSelfClosingElement(child)&&child.tagName.getText(ast)==='DonutPanel');
      if(panels.length){
        pairs.push(panels.map(panel=>panel.attributes.properties.find(prop=>prop.name?.getText(ast)==='title').initializer.text));
        assert.doesNotMatch(node.openingElement.getText(ast),/grid-cols-2/);
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(ast);
  assert.deepEqual(pairs,[['Wyrobiono','Przybyło'],['Wyrobiono','Przybyło'],['Wyrobiono','Przybyło']]);
});

test('names, kilograms and connectors are always rendered without hover or a separate legend',()=>{
  const source=readFileSync(new URL('../../components/reports/RegrindDonutChart.tsx',import.meta.url),'utf8');
  assert.match(source,/cornerRadius=\{9\}/);
  assert.match(source,/paddingAngle=\{Math.min\(3,/);
  assert.match(source,/data-regrind-label="name"/);
  assert.match(source,/data-regrind-label="quantity">\{formatKg\(item.value\)\}/);
  assert.match(source,/layout.callouts.map/);
  assert.doesNotMatch(source,/activeIndex|onMouseEnter|<button|reports-legend-button|monospace|<text|line-clamp/);
});

test('report data includes every material and preserves kilogram totals',()=>{
  const ts=typescript();
  const source=pageSource();
  const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=ast.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]);
  const selected=['chartColors','buildPieItems'].map(name=>`const ${declarations.find(entry=>entry.name.getText(ast)===name).getText(ast)};`).join('\n');
  const code=ts.transpileModule(`${selected}\nglobalThis.build=buildPieItems;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const context=vm.createContext({});
  vm.runInContext(code,context);
  const rows=Array.from({length:20},(_,i)=>({label:`Material ${i}`,kg:i+1}));
  const result=JSON.parse(JSON.stringify(context.build(rows,row=>row.kg)));
  assert.equal(result.length,20);
  assert.equal(result.reduce((sum,row)=>sum+row.value,0),210);
  assert.deepEqual(result.map(row=>row.label),[...rows].reverse().map(row=>row.label));
});
