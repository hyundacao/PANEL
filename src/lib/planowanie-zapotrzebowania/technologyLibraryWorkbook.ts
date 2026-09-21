import type { CellValue, Workbook, Worksheet } from 'exceljs';
import { buildTechnologyLibraryExport, exportProductionMode, type ExportTechnology } from './technologyLibraryExport';

type Column = { header: string; key: string; width: number; numeric?: boolean };
const colors = { header: 'FF293E43', text: 'FF243239', line: 'FFD8E1E4', alternate: 'FFF2F6F7', warning: 'FFFFF0CC', root: 'FFDCEBE7' };
const numberFormat = '#,##0.########';

const createTable = (workbook: Workbook, name: string, columns: Column[], rows: Record<string, CellValue>[]) => {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' }
  });
  sheet.columns = columns.map((column) => ({ ...column }));
  columns.forEach((column, index) => { sheet.getColumn(index + 1).numFmt = column.numeric ? numberFormat : '@'; });
  const header = sheet.getRow(1);
  header.height = 42;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  rows.forEach((data, index) => {
    const row = sheet.addRow(data);
    let lines = 1;
    columns.forEach((column, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      const value = data[column.key];
      if (column.numeric && typeof value === 'number' && Number.isInteger(value)) cell.numFmt = '#,##0';
      const label = typeof value === 'object' && value && 'text' in value ? value.text : String(value ?? '');
      lines = Math.max(lines, ...label.split('\n').map((line) => Math.ceil(line.length / Math.max(8, column.width - 3))));
      cell.font = { name: 'Calibri', size: 11, color: { argb: colors.text } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: column.numeric ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: colors.line } } };
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.alternate } };
      if (typeof value === 'object' && value && 'hyperlink' in value) cell.font = {
        name: 'Calibri', size: 11, color: { argb: 'FF176A89' }, underline: true
      };
    });
    row.height = Math.min(409, Math.max(30, lines * 16 + 10));
  });
  if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
  sheet.headerFooter.oddFooter = '&L Biblioteka technologii &R Strona &P z &N';
  return sheet;
};

const tintRow = (sheet: Worksheet, rowNumber: number, color: string, bold = false) => {
  sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    if (bold) cell.font = { ...cell.font, bold: true };
  });
};

export const createTechnologyLibraryWorkbook = async (technologies: readonly ExportTechnology[], exportedAt = new Date()) => {
  const data = buildTechnologyLibraryExport(technologies);
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'APKA DLA KAMILA';
  workbook.created = exportedAt;
  workbook.modified = exportedAt;
  const firstDirectRow = new Map<number, number>();
  data.direct.forEach((row, index) => {
    if (!firstDirectRow.has(row.parent.number)) firstDirectRow.set(row.parent.number, index + 2);
  });
  const firstTreeRow = new Map<number, number>();
  data.tree.forEach((row, index) => { if (row.depth === 0) firstTreeRow.set(row.root.number, index + 2); });
  const link = (sheet: string, row: number, text: string): CellValue => ({ text, hyperlink: `#'${sheet}'!A${row}` });

  const info = createTable(workbook, 'Jak czytać', [
    { header: 'Temat', key: 'topic', width: 29 }, { header: 'Opis', key: 'text', width: 110 }
  ], [
    { topic: 'Biblioteka technologii', text: `Eksport: ${exportedAt.toLocaleString('pl-PL')}. Wszystkie zapisane w aplikacji technologie: ${data.entries.length}, w tym archiwalne: ${data.entries.filter((entry) => entry.technology.archived).length}. Niezapisany formularz edytora i robocze technologie planu nie są uwzględnione.` },
    { topic: 'Technologie', text: 'Spis produktów i wszystkich wariantów. Link Skład otwiera recepturę, a Drzewo kolejne poziomy półwyrobów.' },
    { topic: 'Skład technologii', text: 'Każdy składnik występuje przy technologii, do której bezpośrednio należy. Przeliczniki dotyczą jednej sztuki rodzica. Materiały na pakowanie nadwyżki mają osobną podstawę naliczania.' },
    { topic: 'Drzewo półwyrobów', text: 'Poziom 0 to wyrób. Poziom 1 to jego składniki, poziom 2 to skład półwyrobu itd. Ścieżka 1.2.1 oznacza pierwszy składnik drugiej pozycji. Wiersze główne mają zielonkawe tło, uwagi żółte.' },
    { topic: 'Z magazynu', text: 'Na tym etapie pobierany jest gotowy składnik. Jego rozwinięcie pokazuje wcześniejszą produkcję, przed przyjęciem na magazyn. Nie oznacza ponownego pobrania jego surowców teraz.' },
    { topic: 'Bezpośrednio z maszyny', text: 'Półwyrób przekazywany do powiązanej produkcji bez etapu magazynowego. Jego skład pokazuje produkcję powiązaną. Terminy pracy maszyn nie wynikają z biblioteki.' },
    { topic: 'Wybór w planie', text: 'Biblioteka dopuszcza wybór źródła. Eksport nie przyjmuje samodzielnie magazynu ani maszyny. Rozwinięcie jest podglądem, a źródło trzeba ustalić w planie.' },
    { topic: 'Kolejne warianty', text: 'Wszystkie warianty są pokazane osobno. Drzewo rozwija aktywną bazową technologię półwyrobu, nie wybiera awaryjnej. Przy niejednoznacznym dopasowaniu rozwijanie zatrzymuje się. Archiwalne warianty nie odtwarzają historycznych wersji półwyrobów.' },
    { topic: 'Ilości i jednostki', text: 'Masy są pokazane w gramach na sztukę, tak jak w edytorze. Nie zaokrąglamy przeliczników do pełnych opakowań. Ilość dotyczy bezpośredniego rodzica, nie produktu z pierwszej kolumny. Brak normy pozostaje pusty.' },
    { topic: 'Bez podwójnego liczenia', text: 'To skład biblioteki, nie dokument zapotrzebowania. Nie sumuj poziomów drzewa, wariantów ani pakowania nadwyżki. Przykład: wyrób pobiera B z magazynu, B pobiera A z magazynu. A i B były produkowane wcześniej, a bieżący wyrób pobiera gotowe B.' },
    { topic: 'Uwagi', text: `${data.issues.length} uwag do danych lub źródeł. Brak technologii półwyrobu nie jest zastępowany zgadywanym składem. Indeksy są tekstem, także te z zerami na początku.` },
    { topic: 'Źródło', text: 'Wspólna biblioteka technologii dostępna w aplikacji w chwili eksportu. Bieżące filtry biblioteki nie ograniczają zawartości pliku.' }
  ]);
  info.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];

  createTable(workbook, 'Technologie', [
    { header: 'Indeks wyrobu', key: 'index', width: 24 }, { header: 'Wyrób / półwyrób', key: 'name', width: 55 },
    { header: 'Wariant', key: 'variant', width: 40 }, { header: 'Status', key: 'status', width: 14 },
    { header: 'Skład', key: 'detail', width: 15 }, { header: 'Drzewo', key: 'tree', width: 15 },
    { header: 'Tryb produkcji', key: 'mode', width: 27 }, { header: 'Norma na zmianę (szt.)', key: 'norm', width: 18, numeric: true },
    { header: 'Materiały', key: 'materials', width: 13, numeric: true }, { header: 'Powiązane półwyroby', key: 'links', width: 18, numeric: true },
    { header: 'Pakowanie nadwyżki (poz.)', key: 'surplus', width: 20, numeric: true }, { header: 'Notatki technologii', key: 'notes', width: 70 }
  ], data.entries.map((entry) => {
    const technology = entry.technology;
    return {
      index: technology.productIndex, name: technology.productName, variant: entry.label,
      status: technology.archived ? 'Archiwalna' : 'Aktywna',
      detail: firstDirectRow.has(entry.number) ? link('Skład technologii', firstDirectRow.get(entry.number)!, 'Otwórz skład') : 'Brak składników',
      tree: link('Drzewo półwyrobów', firstTreeRow.get(entry.number)!, 'Otwórz drzewo'),
      mode: exportProductionMode(technology), norm: technology.shiftNorm > 0 ? technology.shiftNorm : null,
      materials: technology.materials.length, links: technology.linkedProducts?.length ?? 0,
      surplus: technology.surplusMaterials?.length ?? 0, notes: technology.notes
    };
  }));
  const targetLink = (row: (typeof data.direct)[number]): CellValue => row.target
    ? link('Technologie', row.target.number + 1, `${row.target.technology.productIndex || row.target.technology.productName} · ${row.target.label}`) : '';
  const directSheet = createTable(workbook, 'Skład technologii', [
    { header: 'Indeks wyrobu', key: 'index', width: 24 }, { header: 'Wyrób / półwyrób', key: 'name', width: 48 },
    { header: 'Wariant', key: 'variant', width: 32 }, { header: 'Sekcja', key: 'section', width: 25 },
    { header: 'Indeks składnika', key: 'code', width: 24 }, { header: 'Składnik', key: 'component', width: 55 },
    { header: 'Rodzaj', key: 'category', width: 18 }, { header: 'Przelicznik', key: 'usage', width: 16, numeric: true },
    { header: 'J.m.', key: 'unit', width: 10 }, { header: 'Podstawa naliczania', key: 'basis', width: 35 },
    { header: 'Źródło składnika', key: 'source', width: 38 }, { header: 'Technologia składnika', key: 'target', width: 32 },
    { header: 'Uwagi', key: 'note', width: 70 }, { header: 'Status technologii', key: 'status', width: 18 }
  ], data.direct.map((row) => ({
    index: row.parent.technology.productIndex, name: row.parent.technology.productName, variant: row.parent.label,
    section: row.section, code: row.code, component: row.name, category: row.category, usage: row.usage,
    unit: row.unit, basis: row.basis, source: row.source, target: targetLink(row), note: row.note,
    status: row.parent.technology.archived ? 'Archiwalna' : 'Aktywna'
  })));
  data.direct.forEach((row, index) => { if (row.warning) tintRow(directSheet, index + 2, colors.warning); });

  const treeSheet = createTable(workbook, 'Drzewo półwyrobów', [
    { header: 'Indeks wyrobu głównego', key: 'rootIndex', width: 24 }, { header: 'Wariant wyrobu', key: 'variant', width: 32 },
    { header: 'Poziom', key: 'depth', width: 9, numeric: true }, { header: 'Ścieżka', key: 'path', width: 15 },
    { header: 'Indeks rodzica', key: 'parent', width: 24 }, { header: 'Indeks składnika', key: 'code', width: 24 },
    { header: 'Składnik / wyrób', key: 'component', width: 55 },
    { header: 'Przelicznik / rodzic', key: 'usage', width: 16, numeric: true }, { header: 'J.m.', key: 'unit', width: 10 },
    { header: 'Źródło składnika', key: 'source', width: 38 }, { header: 'Etap produkcji rodzica', key: 'stage', width: 42 },
    { header: 'Sekcja', key: 'section', width: 25 }, { header: 'Podstawa naliczania', key: 'basis', width: 35 },
    { header: 'Technologia składnika', key: 'target', width: 32 }, { header: 'Uwagi', key: 'note', width: 70 },
    { header: 'Status technologii wyrobu', key: 'status', width: 20 }
  ], data.tree.map((row) => ({
    rootIndex: row.root.technology.productIndex, variant: row.root.label, depth: row.depth, path: row.path,
    parent: row.depth ? row.parent.technology.productIndex : '', code: row.code, component: row.name,
    usage: row.usage, unit: row.unit, source: row.source, stage: row.stage, section: row.section,
    basis: row.basis, target: targetLink(row), note: row.note, status: row.root.technology.archived ? 'Archiwalna' : 'Aktywna'
  })));
  data.tree.forEach((row, index) => {
    treeSheet.getRow(index + 2).getCell(7).alignment = { vertical: 'middle', wrapText: true, indent: Math.min(5, row.depth) };
    if (row.depth === 0) tintRow(treeSheet, index + 2, colors.root, true);
    else if (row.warning) tintRow(treeSheet, index + 2, colors.warning);
  });

  createTable(workbook, 'Uwagi', [
    { header: 'Indeks wyrobu', key: 'index', width: 24 }, { header: 'Wyrób / półwyrób', key: 'name', width: 48 },
    { header: 'Wariant', key: 'variant', width: 32 }, { header: 'Indeks składnika', key: 'code', width: 24 },
    { header: 'Składnik', key: 'component', width: 55 }, { header: 'Do sprawdzenia', key: 'message', width: 80 }
  ], data.issues.length ? data.issues.map((issue) => ({
    index: issue.technology.technology.productIndex, name: issue.technology.technology.productName,
    variant: issue.technology.label, code: issue.componentCode, component: issue.componentName, message: issue.message
  })) : [{ index: '', name: '', variant: '', code: '', component: '', message: 'Brak uwag do powiązań i przeliczników.' }]);
  return { workbook, data };
};
