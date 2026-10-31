import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ExcelJS = require('exceljs');
const load = file => {
  const mod = new Module(file);
  mod.require = id => id.startsWith('.') ? load(resolve(dirname(file),`${id}.ts`)) : require(id);
  mod._compile(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
  return mod.exports;
};
const {createTechnologyLibraryWorkbook} = load(fileURLToPath(new URL('./technologyLibraryWorkbook.ts',import.meta.url)));
const tech = (productIndex, materials = [], patch = {}) => ({
  id:productIndex,productIndex,productName:`Produkt ${productIndex}`,variant:'base',alternativeNo:0,
  description:'',notes:'Notatka technologii',shiftNorm:2800,materials,archived:false,...patch
});
const material = (code,usage=1) => ({code,name:`Składnik ${code}`,category:'Karton',usage,unit:'szt.',logisticQty:1});

test('saved workbook exports both indices for products, components, parents and issues as text', async () => {
  const catalog = [
    {indexCode:'M-10-PWY-FINAL',indexCode2:'00008001103471'},
    {indexCode:'M-10-PWY-PART',indexCode2:'00008001236303'},
    {indexCode:'M-4-KAR-001',indexCode2:'002/03'},
    {indexCode:'M-1-TW-001',indexCode2:'00012345678901234567'}
  ];
  const library = [
    tech('00008001103471',[material('M-4-KAR-001',1/600)],{
      linkedProducts:[{productIndex:'M-10-PWY-PART',productName:'Półwyrób',usage:1,unit:'szt.',sourcePolicy:'production'}]
    }),
    tech('M-10-PWY-PART',[{...material('00012345678901234567',.038),category:'Tworzywo',unit:'kg'}]),
    tech('UNKNOWN',[{...material('M-1-TW-001',0),category:'Tworzywo',unit:'kg'}],{archived:true})
  ];
  const before = JSON.stringify({catalog,library});
  const {workbook,data} = await createTechnologyLibraryWorkbook(library,new Date('2026-10-31T12:00:00Z'),catalog);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(JSON.stringify({catalog,library}),before);
  assert.deepEqual(restored.worksheets.map(sheet=>sheet.name),['Jak czytać','Technologie','Skład technologii','Drzewo półwyrobów','Uwagi']);
  const table = name => {
    const sheet = restored.getWorksheet(name);
    const headers = sheet.getRow(1).values.slice(1);
    const rows = [];
    sheet.eachRow((row,i)=>{if(i>1) rows.push(Object.fromEntries(headers.map((header,j)=>[header,row.getCell(j+1).value ?? ''])));});
    return {sheet,headers,rows};
  };
  const technologies = table('Technologie');
  assert.deepEqual(technologies.headers.slice(0,3),['Indeks 1','Indeks 2','Wyrób / półwyrób']);
  const product = technologies.rows.find(row=>row['Indeks 2']==='00008001103471');
  assert.equal(product['Indeks 1'],'M-10-PWY-FINAL');
  assert.equal(product['Norma na zmianę (szt.)'],2800);
  assert.match(product['Skład'].hyperlink,/#'Skład technologii'!A\d+/);
  assert.match(product['Drzewo'].hyperlink,/#'Drzewo półwyrobów'!A\d+/);
  const direct = table('Skład technologii');
  const carton = direct.rows.find(row=>row['Indeks 2 składnika']==='002/03');
  assert.equal(carton['Indeks 1 wyrobu'],'M-10-PWY-FINAL');
  assert.equal(carton['Indeks 2 wyrobu'],'00008001103471');
  assert.equal(carton['Indeks 1 składnika'],'M-4-KAR-001');
  assert.equal(carton['Przelicznik'],1/600);
  assert.equal(direct.rows.find(row=>row['Indeks 2 składnika']==='00012345678901234567')['Przelicznik'],38);
  const tree = table('Drzewo półwyrobów');
  const nested = tree.rows.find(row=>row['Indeks 2 wyrobu głównego']==='00008001103471'&&row['Indeks 2 składnika']==='00012345678901234567');
  assert.equal(nested['Indeks 1 rodzica'],'M-10-PWY-PART');
  assert.equal(nested['Indeks 2 rodzica'],'00008001236303');
  assert.equal(nested.Poziom,2);
  const warning = table('Uwagi').rows.find(row=>row['Indeks 1 wyrobu']==='UNKNOWN');
  assert.equal(warning['Indeks 2 wyrobu'],'');
  assert.equal(warning['Indeks 1 składnika'],'M-1-TW-001');
  assert.equal(warning['Indeks 2 składnika'],'00012345678901234567');
  for (const name of ['Technologie','Skład technologii','Drzewo półwyrobów','Uwagi']) {
    const {sheet,headers} = table(name);
    for (let col=1;col<=headers.length;col++) {
      if (!String(headers[col-1]).startsWith('Indeks ')) continue;
      assert.equal(sheet.getColumn(col).numFmt,'@');
      sheet.getColumn(col).eachCell((cell,row)=>{if(row>1&&cell.value) assert.equal(typeof cell.value,'string');});
    }
    assert.equal(sheet.views[0].xSplit,2);
    assert.equal(sheet.views[0].ySplit,1);
    assert.equal(sheet.autoFilter,`A1:${sheet.getColumn(headers.length).letter}${sheet.rowCount}`);
  }
  assert.equal(data.entries.length,3);
});

test('empty and unknown index pairs export blank index 2 without fabricating one', async () => {
  for (const technologies of [[],[tech('M-10-PWY-BSHL-10012',[material('')])]]) {
    const {workbook} = await createTechnologyLibraryWorkbook(technologies);
    const sheet = workbook.getWorksheet('Technologie');
    assert.equal(sheet.getRow(1).getCell('index2').value,'Indeks 2');
    if (technologies.length) {
      assert.equal(sheet.getRow(2).getCell('index1').value,technologies[0].productIndex);
      assert.equal(sheet.getRow(2).getCell('index2').value,'');
      assert.equal(workbook.getWorksheet('Skład technologii').getRow(2).getCell('code1').value,'');
      assert.equal(workbook.getWorksheet('Skład technologii').getRow(2).getCell('code2').value,'');
    }
    await workbook.xlsx.writeBuffer();
  }
});

test('owner-confirmed legacy M-10 pairs populate both Excel columns for old numeric technologies', async () => {
  const {linkOriginalInventoryM10Indices}=await import('../utils/originalInventoryM10Indices.ts');
  const catalog=linkOriginalInventoryM10Indices([
    {id:'primary',name:'TRAY',unit:'szt.',warehouseCode:'M-10',indexCode:'M-10-PWY-BSHL-10008'},
    {id:'secondary',name:'TRAY',unit:'szt.',warehouseCode:'M-10',indexCode:'M-10-8001236303'}
  ]);
  const {workbook}=await createTechnologyLibraryWorkbook([tech('8001236303')],new Date(),catalog);
  const sheet=workbook.getWorksheet('Technologie');
  assert.equal(sheet.getCell('A2').value,'M-10-PWY-BSHL-10008');
  assert.equal(sheet.getCell('B2').value,'M-10-8001236303');
});
