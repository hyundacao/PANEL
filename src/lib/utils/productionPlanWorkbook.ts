import * as XLSX from 'xlsx';

export type ProductionPlanWorkbook = {
  buffer: ArrayBuffer;
  fileName: string;
  sheetNames: string[];
};

export const readProductionPlanWorkbook = (buffer: ArrayBuffer, fileName: string): ProductionPlanWorkbook => {
  const metadata = XLSX.read(buffer, { type: 'array', bookSheets: true });
  if (!metadata.SheetNames?.length) {
    throw new Error('Plik nie zawiera arkuszy do wczytania.');
  }
  return { buffer, fileName, sheetNames: [...metadata.SheetNames] };
};

export const readProductionPlanSheet = (source: ProductionPlanWorkbook, sheetName: string): XLSX.WorkBook => {
  if (!sheetName || !source.sheetNames.includes(sheetName)) {
    throw new Error('Wybierz arkusz z listy.');
  }
  const workbook = XLSX.read(source.buffer, {
    type: 'array',
    cellStyles: true,
    sheets: [sheetName]
  });
  if (!workbook.Sheets[sheetName]) {
    throw new Error('Nie uda\u0142o si\u0119 odczyta\u0107 wybranego arkusza.');
  }
  // Legacy XLS readers can ignore the sheets option.
  return { ...workbook, SheetNames: [sheetName], Sheets: { [sheetName]: workbook.Sheets[sheetName] } };
};
